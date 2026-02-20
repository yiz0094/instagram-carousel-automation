import { readFile, writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..');
const ENV_PATH = join(PROJECT_ROOT, '.env');

export async function readTokenInfo() {
  // CI 환경 (GitHub Actions 등): process.env에서 우선 읽기
  if (process.env.INSTAGRAM_ACCESS_TOKEN && process.env.INSTAGRAM_ACCESS_TOKEN !== 'your_long_lived_token') {
    return {
      token: process.env.INSTAGRAM_ACCESS_TOKEN,
      expiryDate: process.env.TOKEN_EXPIRY_DATE || '2099-12-31',
      appId: process.env.FACEBOOK_APP_ID,
      appSecret: process.env.FACEBOOK_APP_SECRET
    };
  }

  // 로컬 환경: .env 파일에서 읽기
  try {
    const envContent = await readFile(ENV_PATH, 'utf-8');
    const lines = envContent.split('\n');
    const env = {};
    for (const line of lines) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) env[match[1].trim()] = match[2].trim();
    }
    return {
      token: env.INSTAGRAM_ACCESS_TOKEN,
      expiryDate: env.TOKEN_EXPIRY_DATE,
      appId: env.FACEBOOK_APP_ID,
      appSecret: env.FACEBOOK_APP_SECRET
    };
  } catch {
    return { token: null, expiryDate: null, appId: null, appSecret: null };
  }
}

export function isTokenExpiring(expiryDate, daysThreshold = 7) {
  const expiry = new Date(expiryDate);
  const now = new Date();
  const diffDays = (expiry - now) / (1000 * 60 * 60 * 24);
  return diffDays <= daysThreshold;
}

export async function refreshToken(currentToken, appId, appSecret) {
  const url = `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${currentToken}`;
  const res = await fetch(url);
  if (!res.ok) {
    const error = await res.json();
    throw new Error(`Token refresh failed: ${JSON.stringify(error)}`);
  }
  const data = await res.json();
  // New token valid for 60 days
  const newExpiry = new Date();
  newExpiry.setDate(newExpiry.getDate() + 60);
  return {
    token: data.access_token,
    expiryDate: newExpiry.toISOString().split('T')[0]
  };
}

export async function updateEnvFile(newToken, newExpiryDate) {
  // GitHub Actions 환경에서는 .env 파일 업데이트 불가
  if (process.env.GITHUB_ACTIONS) {
    console.log('[TokenManager] GitHub Actions 환경 — .env 파일 업데이트 스킵');
    console.log('[TokenManager] ⚠️ GitHub Secrets에서 INSTAGRAM_ACCESS_TOKEN을 수동으로 갱신하세요.');
    return;
  }

  let envContent = await readFile(ENV_PATH, 'utf-8');
  envContent = envContent.replace(
    /INSTAGRAM_ACCESS_TOKEN=.*/,
    `INSTAGRAM_ACCESS_TOKEN=${newToken}`
  );
  envContent = envContent.replace(
    /TOKEN_EXPIRY_DATE=.*/,
    `TOKEN_EXPIRY_DATE=${newExpiryDate}`
  );
  await writeFile(ENV_PATH, envContent, 'utf-8');
}

export async function checkAndRefresh() {
  const info = await readTokenInfo();
  if (!info.token || info.token === 'your_long_lived_token') {
    console.log('[TokenManager] 토큰이 설정되지 않았습니다. .env 파일을 확인하세요.');
    return null;
  }
  if (isTokenExpiring(info.expiryDate)) {
    console.log(`[TokenManager] 토큰이 ${info.expiryDate}에 만료됩니다. 갱신 중...`);
    try {
      const newInfo = await refreshToken(info.token, info.appId, info.appSecret);
      await updateEnvFile(newInfo.token, newInfo.expiryDate);
      console.log(`[TokenManager] 토큰 갱신 완료. 새 만료일: ${newInfo.expiryDate}`);
      return newInfo.token;
    } catch (err) {
      console.error(`[TokenManager] 토큰 갱신 실패:`, err.message);
      return info.token;
    }
  }
  console.log(`[TokenManager] 토큰 유효. 만료일: ${info.expiryDate}`);
  return info.token;
}

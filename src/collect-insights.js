import { readFile, writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import 'dotenv/config';
import { getMediaInsights } from './utils/instagram-api.js';
import { checkAndRefresh } from './utils/token-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

const CONTENT_LOG_PATH = join(PROJECT_ROOT, 'data', 'content-log.json');
const PERFORMANCE_LOG_PATH = join(PROJECT_ROOT, 'data', 'performance-log.json');

async function loadJson(filePath) {
  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return [];
  }
}

async function saveJson(filePath, data) {
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function shouldCollect(entry, performanceLog) {
  if (!entry.postId) return false;

  const existing = performanceLog.find(p => p.postId === entry.postId);
  if (!existing) return true;

  // Re-collect if last collection was more than 24 hours ago
  const lastCollected = new Date(existing.collectedAt);
  const now = new Date();
  const hoursSince = (now - lastCollected) / (1000 * 60 * 60);

  // Only re-collect for posts within the last 7 days
  const postDate = new Date(entry.date);
  const daysSincePost = (now - postDate) / (1000 * 60 * 60 * 24);

  return daysSincePost <= 7 && hoursSince >= 24;
}

async function collectInsights() {
  const isTest = process.argv.includes('--test');

  console.log('=== 성과 데이터 수집 시작 ===');

  const contentLog = await loadJson(CONTENT_LOG_PATH);
  const performanceLog = await loadJson(PERFORMANCE_LOG_PATH);

  if (contentLog.length === 0) {
    console.log('[Insights] 게시 이력이 없습니다. 수집을 건너뜁니다.');
    return;
  }

  // Filter entries that need collection
  const toCollect = contentLog.filter(entry => shouldCollect(entry, performanceLog));

  if (toCollect.length === 0) {
    console.log('[Insights] 수집할 새로운 데이터가 없습니다.');
    return;
  }

  console.log(`[Insights] ${toCollect.length}개 게시물의 성과 데이터를 수집합니다.`);

  let accessToken = null;
  if (!isTest) {
    accessToken = await checkAndRefresh();
    if (!accessToken) {
      console.error('[Insights] 유효한 토큰이 없습니다. 수집을 중단합니다.');
      return;
    }
  }

  for (const entry of toCollect) {
    try {
      let metrics;

      if (isTest) {
        // Generate mock data for testing
        metrics = {
          impressions: Math.floor(Math.random() * 2000) + 500,
          reach: Math.floor(Math.random() * 1500) + 300,
          likes: Math.floor(Math.random() * 100) + 10,
          comments: Math.floor(Math.random() * 30) + 1,
          saved: Math.floor(Math.random() * 50) + 5,
          shares: Math.floor(Math.random() * 20) + 1
        };
        console.log(`[Insights][TEST] Mock data for ${entry.postId}`);
      } else {
        metrics = await getMediaInsights(entry.postId, accessToken);
      }

      const reach = metrics.reach || 1;
      const engagementRate = (
        (metrics.likes || 0) +
        (metrics.comments || 0) +
        (metrics.saved || 0) +
        (metrics.shares || 0)
      ) / reach;

      const performanceEntry = {
        postId: entry.postId,
        date: entry.date,
        topic: entry.topic,
        category: entry.category,
        format: entry.format || 'tips',
        slideCount: entry.slideCount || 0,
        metrics: {
          impressions: metrics.impressions || 0,
          reach: metrics.reach || 0,
          likes: metrics.likes || 0,
          comments: metrics.comments || 0,
          saved: metrics.saved || 0,
          shares: metrics.shares || 0,
          engagementRate: Math.round(engagementRate * 1000) / 1000
        },
        hashtags: entry.hashtags || [],
        collectedAt: new Date().toISOString()
      };

      // Update or add to performance log
      const existingIndex = performanceLog.findIndex(p => p.postId === entry.postId);
      if (existingIndex >= 0) {
        performanceLog[existingIndex] = performanceEntry;
      } else {
        performanceLog.push(performanceEntry);
      }

      console.log(`[Insights] ${entry.topic}: 참여율 ${(engagementRate * 100).toFixed(1)}%`);

      // Small delay to avoid rate limiting
      if (!isTest) {
        await new Promise(r => setTimeout(r, 500));
      }
    } catch (err) {
      console.error(`[Insights] ${entry.postId} 수집 실패:`, err.message);
    }
  }

  await saveJson(PERFORMANCE_LOG_PATH, performanceLog);
  console.log(`=== 성과 데이터 수집 완료: ${toCollect.length}개 업데이트 ===`);
}

collectInsights().catch(err => {
  console.error('[Insights] 치명적 오류:', err);
  process.exit(1);
});

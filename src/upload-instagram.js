import { config } from 'dotenv';
import { readFile, writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { checkAndRefresh } from './utils/token-manager.js';
import { uploadAllImages } from './utils/imgbb-uploader.js';
import {
  createMediaContainer,
  createCarouselContainer,
  waitForContainer,
  publishMedia
} from './utils/instagram-api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

config({ path: join(PROJECT_ROOT, '.env') });

const isTestMode = process.argv.includes('--test');
const PIPELINE_STATE_PATH = join(PROJECT_ROOT, 'data', 'pipeline-state.json');
const CONTENT_LOG_PATH = join(PROJECT_ROOT, 'data', 'content-log.json');

async function main() {
  console.log(`\n=== Instagram Upload ${isTestMode ? '(TEST MODE)' : ''} ===\n`);

  // Step 1: Check and refresh token
  console.log('[1/6] 토큰 확인 중...');
  let accessToken;
  if (isTestMode) {
    console.log('[TEST] 토큰 확인 스킵');
    accessToken = 'test_token_placeholder';
  } else {
    accessToken = await checkAndRefresh();
    if (!accessToken) {
      console.error('유효한 토큰이 없습니다. 업로드를 중단합니다.');
      process.exit(1);
    }
  }

  // Step 2: Read pipeline state
  console.log('[2/6] 파이프라인 상태 읽는 중...');
  const pipelineState = JSON.parse(await readFile(PIPELINE_STATE_PATH, 'utf-8'));
  const { finalPackage, generatedImages } = pipelineState;

  if (!finalPackage || !generatedImages || generatedImages.length === 0) {
    console.error('파이프라인 상태에 필요한 데이터가 없습니다.');
    process.exit(1);
  }

  console.log(`  - 주제: ${finalPackage.topic || finalPackage.title}`);
  console.log(`  - 이미지 수: ${generatedImages.length}`);

  // Step 3: Upload images to imgbb
  console.log('[3/6] imgbb에 이미지 업로드 중...');
  let imageUrls;
  if (isTestMode) {
    imageUrls = generatedImages.map((_, i) => `https://i.ibb.co/test/image_${i + 1}.png`);
    console.log('[TEST] 이미지 업로드 스킵');
    imageUrls.forEach((url, i) => console.log(`  [${i + 1}] ${url}`));
  } else {
    const imgbbApiKey = process.env.IMGBB_API_KEY;
    if (!imgbbApiKey) {
      console.error('IMGBB_API_KEY가 .env에 설정되지 않았습니다.');
      process.exit(1);
    }
    imageUrls = await uploadAllImages(generatedImages, imgbbApiKey);
  }

  // Step 4: Create child media containers
  console.log('[4/6] Instagram 미디어 컨테이너 생성 중...');
  const igUserId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  let childrenIds;

  if (isTestMode) {
    childrenIds = imageUrls.map((_, i) => `test_container_${i + 1}`);
    console.log('[TEST] 컨테이너 생성 스킵');
    childrenIds.forEach((id, i) => console.log(`  [${i + 1}] Container ID: ${id}`));
  } else {
    childrenIds = [];
    for (const imageUrl of imageUrls) {
      const containerId = await createMediaContainer(igUserId, imageUrl, accessToken);
      childrenIds.push(containerId);
    }

    // Wait for all child containers to finish processing
    console.log('  컨테이너 처리 대기 중...');
    for (const containerId of childrenIds) {
      await waitForContainer(containerId, accessToken);
    }
  }

  // Step 5: Create and publish carousel
  console.log('[5/6] 캐러셀 생성 및 게시 중...');
  const hashtagStr = Array.isArray(finalPackage.hashtags) ? finalPackage.hashtags.join(' ') : '';
  const caption = (finalPackage.caption || '') + (hashtagStr ? '\n\n' + hashtagStr : '');
  console.log(`  - 캡션 길이: ${caption.length}자`);

  let postId;
  if (isTestMode) {
    postId = 'test_post_id_12345';
    console.log('[TEST] 캐러셀 게시 스킵');
    console.log(`  - Caption:\n${caption}`);
    console.log(`  - Children: ${childrenIds.join(', ')}`);
    console.log(`  - Post ID: ${postId}`);
  } else {
    const carouselId = await createCarouselContainer(igUserId, childrenIds, caption, accessToken);
    await waitForContainer(carouselId, accessToken);
    postId = await publishMedia(igUserId, carouselId, accessToken);
  }

  // Step 6: Update content log
  console.log('[6/6] 콘텐츠 로그 업데이트 중...');
  const logEntry = {
    date: new Date().toISOString().split('T')[0],
    topic: finalPackage.topic || finalPackage.title,
    category: finalPackage.category || 'general',
    keywords: finalPackage.keywords || [],
    slideCount: generatedImages.length,
    postId: postId
  };

  let contentLog;
  try {
    contentLog = JSON.parse(await readFile(CONTENT_LOG_PATH, 'utf-8'));
  } catch {
    contentLog = [];
  }
  contentLog.push(logEntry);
  await writeFile(CONTENT_LOG_PATH, JSON.stringify(contentLog, null, 2), 'utf-8');
  console.log(`  - 로그 저장 완료: ${CONTENT_LOG_PATH}`);

  console.log(`\n=== 업로드 완료! Post ID: ${postId} ===\n`);
}

main().catch(err => {
  console.error('\n[ERROR] 업로드 실패:', err.message);
  process.exit(1);
});

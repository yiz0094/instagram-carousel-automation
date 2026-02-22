/**
 * pexels-api.js
 *
 * Pexels API wrapper for fetching cover slide background photos.
 * 핵심 조건: "사람이 나오는 사진" 딱 하나만 충족하면 됨.
 *
 * 전략:
 *   - 4개 랜덤 쿼리 × 80장/페이지 × 랜덤 페이지(1~15) = 최대 320장 raw 후보
 *   - 사람 감지 스코어링 후 상위 후보 중 랜덤 선택
 *   - usedPhotoIds로 절대 중복 방지
 *
 * Usage:
 *   import { searchCoverPhoto } from './utils/pexels-api.js';
 *   const photo = await searchCoverPhoto('SNS 마케팅', apiKey);
 */

const PEXELS_API_URL = 'https://api.pexels.com/v1/search';

// ---------------------------------------------------------------------------
// 넓은 범위의 인물 사진 검색 쿼리 풀 (50개)
// ---------------------------------------------------------------------------
const PERSON_QUERIES = [
  // 포트레이트 & 라이프스타일
  'person portrait',
  'woman portrait',
  'man portrait',
  'professional portrait',
  'lifestyle portrait',
  'casual portrait natural',
  'confident person',
  'smiling person',

  // 직업 & 업무
  'person working laptop',
  'person office modern',
  'entrepreneur portrait',
  'freelancer cafe',
  'creative professional',
  'business person',
  'person meeting room',
  'person presenting',

  // 도시 & 야외
  'person city street',
  'person urban style',
  'person walking outdoor',
  'person rooftop view',
  'woman outdoor natural',
  'man outdoor casual',
  'person park bench',
  'person standing building',

  // 패션 & 스타일
  'fashion portrait',
  'stylish person',
  'person minimal background',
  'model casual wear',
  'person studio portrait',
  'person elegant style',

  // 일상 & 캔디드
  'person reading',
  'person smartphone',
  'person coffee shop',
  'person thinking',
  'candid portrait',
  'natural light portrait',
  'person laughing',
  'person relaxing',

  // 다양성
  'young adult portrait',
  'mature professional',
  'person diverse background',
  'group people casual',
  'person warm light',
  'person cool tone portrait',

  // 추가 넓은 범위
  'people lifestyle',
  'human portrait photography',
  'person close up',
  'adult casual photo',
  'person looking camera',
  'portrait photography',
];

// ---------------------------------------------------------------------------
// Photo scoring - 사람이 보이는지가 핵심
// ---------------------------------------------------------------------------

/** Words in alt text that indicate a person is visible */
const PEOPLE_WORDS = [
  'person', 'woman', 'man', 'people', 'professional', 'businessman',
  'businesswoman', 'entrepreneur', 'smiling', 'portrait', 'holding',
  'working', 'sitting', 'standing', 'presenting', 'creator', 'influencer',
  'young', 'adult', 'team', 'colleague', 'model', 'girl', 'boy',
  'lady', 'guy', 'male', 'female', 'face', 'looking', 'posing',
  'wearing', 'happy', 'serious', 'thoughtful', 'confident',
];

/** Words that suggest irrelevant photos (penalty) */
const PENALTY_WORDS = [
  'animal', 'cat', 'dog', 'food', 'landscape', 'nature', 'flower',
  'sunset', 'mountain', 'ocean', 'beach', 'abstract', 'texture',
  'pattern', 'illustration', 'cartoon', 'drawing', 'painting',
  'monochrome', 'black and white', 'statue', 'sculpture', 'building only',
];

/**
 * Score a photo candidate (higher = better).
 * 핵심: 사람이 보이는 사진이면 높은 점수.
 */
function scorePhoto(photo) {
  let score = 0;
  const alt = (photo.alt || '').toLowerCase();

  // 사람 존재 여부 (가장 중요)
  const peopleCount = PEOPLE_WORDS.filter(w => alt.includes(w)).length;
  score += peopleCount * 15;

  // 사람이 하나도 감지 안 되면 큰 페널티
  if (peopleCount === 0) score -= 50;

  // 부적절한 콘텐츠 페널티
  const penaltyCount = PENALTY_WORDS.filter(w => alt.includes(w)).length;
  score -= penaltyCount * 25;

  // 해상도 보너스 (고해상도 선호)
  const minDim = Math.min(photo.width, photo.height);
  if (minDim >= 3000) score += 10;
  else if (minDim >= 2000) score += 5;

  // 4:5 비율에 가까울수록 보너스 (캐러셀 최적)
  const ratio = photo.width / photo.height;
  if (ratio >= 0.7 && ratio <= 0.9) score += 10;  // 4:5 = 0.8
  else if (ratio >= 0.6 && ratio <= 1.0) score += 5;

  // 적정 밝기 보너스
  if (photo.avg_color) {
    const hex = photo.avg_color;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const brightness = (r + g + b) / 3;
    if (brightness >= 60 && brightness <= 180) score += 5;
  }

  return score;
}

// ---------------------------------------------------------------------------
// Main search function
// ---------------------------------------------------------------------------

/**
 * Search Pexels for a cover photo with a person.
 * "사람이 나오는 사진"을 매우 넓은 풀에서 랜덤 검색.
 * 4개 쿼리 × 80장 = 최대 320장 후보에서 선택.
 *
 * @param {string} _query  - Content topic (참고용, 검색에 직접 사용 안 함)
 * @param {string} apiKey - Pexels API key
 * @param {number[]} usedPhotoIds - Array of Pexels photo IDs to exclude
 * @returns {Promise<{url: string, photographer: string, photographerUrl: string, pexelsUrl: string, pexelsId: number} | null>}
 */
export async function searchCoverPhoto(_query, apiKey, usedPhotoIds = []) {
  const usedSet = new Set(usedPhotoIds); // Set으로 변환 (O(1) lookup)

  // 랜덤으로 검색 쿼리 4개를 선택
  const shuffled = [...PERSON_QUERIES].sort(() => Math.random() - 0.5);
  const queriesToTry = shuffled.slice(0, 4);

  // 모든 후보를 모은 뒤 최종 선택
  let allCandidates = [];

  for (const searchQuery of queriesToTry) {
    // 랜덤 페이지 (1~15)로 다양성 극대화
    const page = Math.floor(Math.random() * 15) + 1;
    const url = `${PEXELS_API_URL}?query=${encodeURIComponent(searchQuery)}&per_page=80&page=${page}`;

    console.log(`    Trying: "${searchQuery}" (page ${page})`);

    try {
      const res = await fetch(url, {
        headers: { Authorization: apiKey },
      });

      if (!res.ok) {
        console.log(`    API error: ${res.status}, skipping...`);
        continue;
      }

      const data = await res.json();
      if (!data.photos || data.photos.length === 0) {
        console.log(`    No photos returned, skipping...`);
        continue;
      }

      console.log(`    Got ${data.photos.length} photos`);

      // 이전 사용 이미지 필터링 (절대 중복 불가)
      const available = data.photos.filter(p => !usedSet.has(p.id));

      if (available.length === 0) {
        console.log(`    All ${data.photos.length} photos already used, skipping...`);
        continue;
      }

      if (available.length < data.photos.length) {
        console.log(`    Filtered out ${data.photos.length - available.length} previously used photo(s)`);
      }

      // 점수 매기기
      const scored = available.map(photo => ({
        photo,
        score: scorePhoto(photo),
      }));

      allCandidates.push(...scored);
    } catch (err) {
      console.log(`    Error: ${err.message}, skipping...`);
    }
  }

  if (allCandidates.length === 0) {
    console.log('    No candidates found from any query');
    return null;
  }

  // 중복 제거 (같은 사진이 여러 쿼리에서 나올 수 있음)
  const seen = new Set();
  allCandidates = allCandidates.filter(({ photo }) => {
    if (seen.has(photo.id)) return false;
    seen.add(photo.id);
    return true;
  });

  // 사람이 있는 사진만 필터 (score > 0)
  const withPeople = allCandidates.filter(c => c.score > 0);
  const candidates = withPeople.length > 0 ? withPeople : allCandidates;

  // 점수 내림차순 정렬
  candidates.sort((a, b) => b.score - a.score);

  // 상위 후보 로깅
  candidates.slice(0, 5).forEach(({ photo, score }, idx) => {
    const alt = (photo.alt || '').slice(0, 60);
    console.log(`    [candidate ${idx + 1}] score=${score} id=${photo.id} | ${alt}...`);
  });

  console.log(`    Total candidates: ${candidates.length} (from ${allCandidates.length} raw, ${usedSet.size} excluded)`);

  // 상위 20개 중 랜덤 선택 (풀이 충분히 넓으므로)
  const topN = Math.min(20, candidates.length);
  const pickIdx = Math.floor(Math.random() * topN);
  const picked = candidates[pickIdx].photo;
  console.log(`    Selected candidate ${pickIdx + 1} of top ${topN} (id: ${picked.id})`);

  return {
    url: picked.src.large2x,
    photographer: picked.photographer,
    photographerUrl: picked.photographer_url,
    pexelsUrl: picked.url,
    pexelsId: picked.id,
  };
}

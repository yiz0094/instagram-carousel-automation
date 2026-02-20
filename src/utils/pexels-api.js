/**
 * pexels-api.js
 *
 * Pexels API wrapper for fetching cover slide background photos.
 * Searches for topic-relevant, people-focused stock images.
 * Scores candidates by quality, people presence, and visual appeal.
 *
 * Usage:
 *   import { searchCoverPhoto } from './utils/pexels-api.js';
 *   const photo = await searchCoverPhoto('SNS 마케팅', apiKey);
 */

const PEXELS_API_URL = 'https://api.pexels.com/v1/search';

// ---------------------------------------------------------------------------
// Korean topic → English search keywords mapping
// ---------------------------------------------------------------------------
const TOPIC_KEYWORDS = [
  { pattern: /마케팅|광고|홍보/, keywords: 'marketing business professional' },
  { pattern: /SNS|소셜|인스타|틱톡/, keywords: 'social media smartphone' },
  { pattern: /창업|사업|비즈니스/, keywords: 'startup entrepreneur business' },
  { pattern: /브랜딩|브랜드/, keywords: 'branding creative design' },
  { pattern: /매출|수익|돈|투자/, keywords: 'finance success money' },
  { pattern: /콘텐츠|영상|크리에이터/, keywords: 'content creator laptop' },
  { pattern: /리더|경영|대표|CEO/, keywords: 'leadership CEO executive' },
  { pattern: /습관|자기계발|성장/, keywords: 'personal growth motivation' },
  { pattern: /디자인|시각|UI/, keywords: 'design creative workspace' },
  { pattern: /고객|서비스|CRM/, keywords: 'customer service meeting' },
  { pattern: /카페|가게|매장|식당/, keywords: 'small business shop owner' },
  { pattern: /해시태그|팔로워|알고리즘/, keywords: 'social media influencer phone' },
  { pattern: /릴스|숏폼|영상/, keywords: 'video content creator filming' },
  { pattern: /이메일|뉴스레터/, keywords: 'email marketing laptop' },
  { pattern: /데이터|분석|통계/, keywords: 'data analytics dashboard' },
];

/**
 * Convert Korean topic to English search keywords for better Pexels results.
 */
function topicToEnglishQuery(koreanTopic) {
  const matched = [];
  for (const { pattern, keywords } of TOPIC_KEYWORDS) {
    if (pattern.test(koreanTopic)) {
      matched.push(keywords);
    }
  }
  // Default fallback if no patterns match
  if (matched.length === 0) {
    return 'business professional person';
  }
  return matched.join(' ');
}

// ---------------------------------------------------------------------------
// Photo scoring - pick the best candidate
// ---------------------------------------------------------------------------

/** Words in alt text that indicate a person is visible and prominent */
const PEOPLE_WORDS = [
  'person', 'woman', 'man', 'people', 'professional', 'businessman',
  'businesswoman', 'entrepreneur', 'smiling', 'portrait', 'holding',
  'working', 'sitting', 'standing', 'presenting', 'creator', 'influencer',
  'young', 'adult', 'team', 'colleague',
];

/** Words that suggest business/professional context (bonus) */
const BUSINESS_WORDS = [
  'business', 'office', 'laptop', 'marketing', 'professional', 'meeting',
  'workspace', 'desk', 'startup', 'creative', 'strategy', 'presentation',
  'conference', 'smartphone', 'technology', 'modern', 'corporate',
];

/** Words that suggest low-quality or irrelevant photos (penalty) */
const PENALTY_WORDS = [
  'animal', 'cat', 'dog', 'food', 'landscape', 'nature', 'flower',
  'sunset', 'mountain', 'ocean', 'beach', 'abstract', 'texture',
  'pattern', 'illustration', 'cartoon', 'drawing', 'painting',
  'monochrome', 'black and white',
];

/**
 * Score a photo candidate (higher = better).
 * @param {object} photo - Pexels photo object
 * @returns {number} score
 */
function scorePhoto(photo) {
  let score = 0;
  const alt = (photo.alt || '').toLowerCase();

  // People presence (most important - user wants people in cover)
  const peopleCount = PEOPLE_WORDS.filter(w => alt.includes(w)).length;
  score += peopleCount * 15;

  // Business/professional context
  const businessCount = BUSINESS_WORDS.filter(w => alt.includes(w)).length;
  score += businessCount * 8;

  // Penalty for irrelevant content
  const penaltyCount = PENALTY_WORDS.filter(w => alt.includes(w)).length;
  score -= penaltyCount * 20;

  // Resolution bonus (prefer high-res)
  const minDim = Math.min(photo.width, photo.height);
  if (minDim >= 3000) score += 10;
  else if (minDim >= 2000) score += 5;

  // Portrait or near-4:5 aspect ratio bonus (better for 4:5 crop)
  const ratio = photo.width / photo.height;
  if (ratio >= 0.7 && ratio <= 0.9) score += 10;  // 4:5 = 0.8
  else if (ratio >= 0.6 && ratio <= 1.0) score += 5;

  // Color richness: avoid very light or very dark average colors
  if (photo.avg_color) {
    const hex = photo.avg_color;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const brightness = (r + g + b) / 3;
    // Sweet spot: moderate brightness (not washed out, not too dark)
    if (brightness >= 60 && brightness <= 180) score += 5;
  }

  return score;
}

// ---------------------------------------------------------------------------
// Main search function
// ---------------------------------------------------------------------------

/**
 * Search Pexels for the best cover photo matching the given topic.
 *
 * @param {string} query  - Content topic (e.g. "SNS 마케팅 초보 가이드")
 * @param {string} apiKey - Pexels API key
 * @returns {Promise<{url: string, photographer: string, photographerUrl: string, pexelsUrl: string} | null>}
 */
export async function searchCoverPhoto(query, apiKey) {
  // Convert Korean topic to English keywords for better results
  const englishQuery = topicToEnglishQuery(query);
  const searchQuery = `${englishQuery} person`;

  const url = `${PEXELS_API_URL}?query=${encodeURIComponent(searchQuery)}&per_page=15&orientation=square`;

  const res = await fetch(url, {
    headers: {
      Authorization: apiKey,
    },
  });

  if (!res.ok) {
    throw new Error(`Pexels API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();

  if (!data.photos || data.photos.length === 0) {
    return null;
  }

  // Score all candidates and pick the best one
  const scored = data.photos.map(photo => ({
    photo,
    score: scorePhoto(photo),
  }));

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Log top 3 candidates for debugging
  scored.slice(0, 3).forEach(({ photo, score }, i) => {
    const alt = (photo.alt || '').slice(0, 60);
    console.log(`    [candidate ${i + 1}] score=${score} | ${alt}...`);
  });

  const best = scored[0].photo;

  return {
    url: best.src.large2x,              // ~1880px wide, high resolution
    photographer: best.photographer,
    photographerUrl: best.photographer_url,
    pexelsUrl: best.url,
  };
}

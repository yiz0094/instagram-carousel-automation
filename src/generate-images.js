/**
 * generate-images.js
 *
 * Image Generator Agent
 * - Reads pipeline-state.json for slide content and design settings
 * - Selects the correct HTML template based on content format
 * - Injects slide data into template placeholders
 * - Renders each slide with Playwright (1080x1350 4:5, waits for Korean font CDN)
 * - Optimizes PNG -> JPEG with Sharp (quality 90, mozjpeg)
 * - Saves results back to pipeline-state.json
 *
 * Usage:
 *   node src/generate-images.js          # Normal run (requires pipeline-state.json)
 *   node src/generate-images.js --test   # Generate with sample Korean marketing data
 */

import 'dotenv/config';
import { chromium } from 'playwright';
import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { searchCoverPhoto } from './utils/pexels-api.js';

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const PATHS = {
  pipelineState: path.join(PROJECT_ROOT, 'data', 'pipeline-state.json'),
  templates: path.join(PROJECT_ROOT, 'src', 'templates'),
  output: path.join(PROJECT_ROOT, 'output'),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Brand colors (immutable – always override agent-chosen colors)
// ---------------------------------------------------------------------------
const BRAND_COLORS = {
  primaryColor: '#51B498',
  secondaryColor: '#17363C',
  accentColor: '#3AA17E',
  backgroundColor: '#FAFFFE',
  textColor: '#17363C',
};

/** Convert hex color (#RRGGBB) to "R,G,B" string for use in rgba(). */
function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r},${g},${b}`;
}

/** Pad a number to two digits: 1 -> "01" */
function pad(n) {
  return String(n).padStart(2, '0');
}

/** Replace all {{key}} placeholders in a template string. */
function injectVariables(template, variables) {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    // Replace all occurrences of {{key}} (global)
    const pattern = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    result = result.replace(pattern, value ?? '');
  }
  return result;
}

/** Build the template path for a given format. */
function getTemplatePath(format) {
  const normalized = format.toLowerCase().trim();
  return path.join(PATHS.templates, `template-${normalized}.html`);
}

/** Clean the output directory – remove all files, then recreate it. */
async function cleanOutputDir() {
  try {
    const entries = await fs.readdir(PATHS.output);
    for (const entry of entries) {
      await fs.rm(path.join(PATHS.output, entry), { recursive: true, force: true });
    }
  } catch {
    // Directory may not exist yet
  }
  await fs.mkdir(PATHS.output, { recursive: true });
}

// ---------------------------------------------------------------------------
// Sample data for --test mode
// ---------------------------------------------------------------------------

function createTestData() {
  return {
    contentBrief: {
      topic: 'SNS 마케팅 초보 가이드',
      contentStrategy: {
        format: 'tips',
        tone: 'friendly',
        targetAudience: '소규모 비즈니스 운영자, 마케팅 초보자',
      },
      colorScheme: {
        primary: '#51B498',
        secondary: '#17363C',
        accent: '#3AA17E',
        background: '#FAFFFE',
        text: '#17363C',
      },
    },
    finalPackage: {
      slides: [
        {
          slideNumber: 1,
          headline: 'SNS 마케팅\n초보 가이드',
          subtext: '팔로워 0에서 1만까지',
          emoji: '📱',
        },
        {
          slideNumber: 2,
          headline: '왜 SNS 마케팅인가?',
          body: '전 세계 49억 명이 소셜 미디어를 사용합니다. 고객이 이미 있는 곳에서 비즈니스를 알리세요.',
          highlight: '49억 명이 사용',
          emoji: '🌍',
        },
        {
          slideNumber: 3,
          headline: '프로필 최적화하기',
          body: '프로필 사진, 바이오, 링크를 전략적으로 구성하세요. 첫인상이 팔로우 결정의 80%를 좌우합니다.',
          highlight: '첫인상이 80%',
          emoji: '✨',
        },
        {
          slideNumber: 4,
          headline: '콘텐츠 캘린더 만들기',
          body: '주 3~5회 일관된 포스팅이 핵심입니다. 미리 한 달치 콘텐츠를 계획하고 예약 발행하세요.',
          highlight: '주 3~5회 포스팅',
          emoji: '📅',
        },
        {
          slideNumber: 5,
          headline: '해시태그 전략 세우기',
          body: '대형, 중형, 소형 해시태그를 균형 있게 조합하세요. 15~20개가 최적입니다.',
          highlight: '15~20개 최적',
          emoji: '#️⃣',
        },
        {
          slideNumber: 6,
          headline: '릴스와 숏폼 활용',
          body: '릴스는 일반 게시물 대비 도달률이 3배 이상 높습니다. 15~30초로 핵심만 전달하세요.',
          highlight: '도달률 3배',
          emoji: '🎬',
        },
        {
          slideNumber: 7,
          headline: '커뮤니티와 소통하기',
          body: '댓글, DM, 스토리 반응에 적극 응답하세요. 소통률이 높을수록 알고리즘이 더 노출합니다.',
          highlight: '적극 응답하기',
          emoji: '💬',
        },
        {
          slideNumber: 8,
          headline: '지금 시작하세요!',
          body: '이 가이드가 도움이 되셨다면\n저장하고 친구에게 공유해 주세요',
          subtext: '더 많은 마케팅 팁은 팔로우!',
          emoji: '🚀',
        },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Main image generation pipeline
// ---------------------------------------------------------------------------

async function generateImages() {
  const isTest = process.argv.includes('--test');

  console.log('='.repeat(60));
  console.log(' Image Generator Agent');
  console.log('='.repeat(60));

  // ── 1. Load or create pipeline state ──────────────────────────────────
  let pipelineState;

  if (isTest) {
    console.log('\n[TEST MODE] Creating sample pipeline-state.json ...');
    pipelineState = createTestData();
    await fs.mkdir(path.dirname(PATHS.pipelineState), { recursive: true });
    await fs.writeFile(PATHS.pipelineState, JSON.stringify(pipelineState, null, 2), 'utf-8');
    console.log(`  -> Saved to ${PATHS.pipelineState}`);
  } else {
    try {
      const raw = await fs.readFile(PATHS.pipelineState, 'utf-8');
      pipelineState = JSON.parse(raw);
    } catch (err) {
      console.error(`\n[ERROR] Cannot read pipeline-state.json: ${err.message}`);
      console.error('  Run with --test to generate sample data, or ensure the pipeline has written data/pipeline-state.json.');
      process.exit(1);
    }
  }

  const { finalPackage, contentBrief } = pipelineState;

  if (!finalPackage?.slides?.length) {
    console.error('\n[ERROR] No slides found in finalPackage.');
    process.exit(1);
  }

  // ── 2. Resolve template ───────────────────────────────────────────────
  const format = contentBrief?.contentStrategy?.format ?? 'tips';
  const templatePath = getTemplatePath(format);

  console.log(`\n  Format     : ${format}`);
  console.log(`  Template   : ${templatePath}`);
  console.log(`  Slides     : ${finalPackage.slides.length}`);

  let templateHtml;
  try {
    templateHtml = await fs.readFile(templatePath, 'utf-8');
  } catch {
    console.error(`\n[ERROR] Template not found: ${templatePath}`);
    console.error(`  Make sure src/templates/template-${format}.html exists.`);
    process.exit(1);
  }

  // Inline the shared stylesheet (page.setContent doesn't resolve relative hrefs)
  const stylesPath = path.join(PATHS.templates, 'styles.css');
  try {
    const sharedCss = await fs.readFile(stylesPath, 'utf-8');
    templateHtml = templateHtml.replace(
      /<link\s+rel="stylesheet"\s+href="styles\.css"\s*\/?>/i,
      `<style>${sharedCss}</style>`
    );
    console.log('  Inlined shared styles.css');
  } catch {
    console.warn('  [WARN] Could not inline styles.css');
  }

  // ── 3. Brand color variables (immutable) ─────────────────────────────
  // Always use brand colors regardless of what agents put in colorScheme.
  // This ensures brand identity (mint-to-deep-teal green) is never broken.
  const colorVars = {
    ...BRAND_COLORS,
    primaryRgb: hexToRgb(BRAND_COLORS.primaryColor),   // "81,180,152"
    accentRgb: hexToRgb(BRAND_COLORS.accentColor),     // "58,161,126"
    secondaryRgb: hexToRgb(BRAND_COLORS.secondaryColor), // "23,54,60"
  };

  // ── 3b. Prepare design directive tokens ──────────────────────────────
  const designDirective = pipelineState.designDirective || {};
  const globalStyle = designDirective.globalStyle || {};
  const slideDirectives = designDirective.slideDirectives || [];

  if (slideDirectives.length > 0) {
    console.log(`  Design     : ${globalStyle.mood || 'default'} / ${globalStyle.decorativeIntensity || 'moderate'}`);
    console.log(`  Directives : ${slideDirectives.length} slide(s)`);
  } else {
    console.log('  Design     : default (no designDirective found)');
  }

  // ── 4. Clean output directory ─────────────────────────────────────────
  console.log('\n  Cleaning output directory ...');
  await cleanOutputDir();

  // ── 4b. Fetch cover photo from Pexels ───────────────────────────────
  let coverPhoto = null;
  const pexelsApiKey = process.env.PEXELS_API_KEY;

  if (pexelsApiKey && pexelsApiKey !== 'your_pexels_api_key') {
    const topic = contentBrief?.topic || contentBrief?.selectedTopic?.title || '';
    if (topic) {
      console.log(`\n  Searching Pexels for: "${topic}" ...`);
      try {
        coverPhoto = await searchCoverPhoto(topic, pexelsApiKey);
        if (coverPhoto) {
          console.log(`  Found: photo by ${coverPhoto.photographer}`);
        } else {
          console.log('  No matching photo found, using gradient fallback');
        }
      } catch (err) {
        console.warn(`  [WARN] Pexels search failed: ${err.message}`);
      }
    }
  } else {
    console.log('\n  No PEXELS_API_KEY set, using gradient fallback for cover');
  }

  // ── 5. Launch browser & render slides ─────────────────────────────────
  console.log('  Launching browser ...\n');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1080, height: 1350 },
    deviceScaleFactor: 1,
  });

  const generatedImages = [];

  try {
    for (const slide of finalPackage.slides) {
      const idx = slide.slideNumber ?? (finalPackage.slides.indexOf(slide) + 1);
      const label = `slide-${pad(idx)}`;

      console.log(`  [${label}] Rendering ...`);

      // Build design token variables for this slide
      const dir = slideDirectives.find(d => d.slideNumber === idx) || {};
      const designVars = {
        layoutVariant: dir.layoutVariant && dir.layoutVariant !== 'default'
          ? `layout-${dir.layoutVariant}` : '',
        backgroundStyle: dir.backgroundStyle && dir.backgroundStyle !== 'plain'
          ? `bg-${dir.backgroundStyle}` : '',
        numberStyle: dir.numberStyle && dir.numberStyle !== 'large-watermark'
          ? `num-${dir.numberStyle}` : '',
        decoClass: `deco-${globalStyle.decorativeIntensity || 'moderate'}`,
      };

      // Build variable map: slide fields + color scheme + design tokens + totalSlides
      const variables = {
        ...colorVars,
        ...designVars,
        ...slide,
        slideNumber: String(idx),
        totalSlides: String(finalPackage.slides.length),
      };

      // Inject cover photo variables for slide 1
      if (idx === 1 && coverPhoto) {
        variables.coverImageUrl = coverPhoto.url;
        variables.photographerName = coverPhoto.photographer;
        variables.hasCoverImage = 'true';
      } else {
        variables.coverImageUrl = '';
        variables.photographerName = '';
        variables.hasCoverImage = '';
      }

      // Convert any nested objects or arrays to string representations
      for (const [k, v] of Object.entries(variables)) {
        if (typeof v === 'object' && v !== null) {
          variables[k] = JSON.stringify(v);
        }
      }

      // Inject variables into template
      const html = injectVariables(templateHtml, variables);

      // Render with Playwright
      const page = await context.newPage();
      await page.setContent(html, { waitUntil: 'networkidle' });

      // Paths
      const pngPath = path.join(PATHS.output, `${label}.png`);
      const jpgPath = path.join(PATHS.output, `${label}.jpg`);

      // Screenshot as PNG
      await page.screenshot({ path: pngPath, fullPage: false });
      await page.close();

      // Convert PNG -> JPEG with Sharp
      await sharp(pngPath)
        .jpeg({ quality: 90, mozjpeg: true })
        .toFile(jpgPath);

      // Remove intermediate PNG
      await fs.unlink(pngPath);

      generatedImages.push(jpgPath);
      console.log(`  [${label}] -> ${jpgPath}`);
    }
  } finally {
    await browser.close();
  }

  // ── 6. Update pipeline state ──────────────────────────────────────────
  pipelineState.generatedImages = generatedImages;
  await fs.writeFile(PATHS.pipelineState, JSON.stringify(pipelineState, null, 2), 'utf-8');

  console.log(`\n  Updated pipeline-state.json with ${generatedImages.length} image paths.`);
  console.log('\n' + '='.repeat(60));
  console.log(` Done! ${generatedImages.length} images generated in output/`);
  console.log('='.repeat(60));

  return generatedImages;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
generateImages().catch((err) => {
  console.error('\n[FATAL]', err);
  process.exit(1);
});

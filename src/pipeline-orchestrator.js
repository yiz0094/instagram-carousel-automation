/**
 * Instagram Carousel Pipeline Orchestrator
 *
 * Anthropic Messages API + Tool Use로 7명의 AI 에이전트를 순차 실행하고,
 * 이미지 생성 및 Instagram 업로드까지 전체 파이프라인을 자동화합니다.
 *
 * GitHub Actions에서 매일 자동 실행되도록 설계되었습니다.
 * 로컬에서도 `node src/pipeline-orchestrator.js` 로 직접 실행 가능합니다.
 */

import Anthropic from '@anthropic-ai/sdk';
import { execSync } from 'child_process';
import { readFile, writeFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

// dotenv: .env 파일이 없으면 조용히 실패 (GitHub Actions 환경 대응)
try { await import('dotenv/config'); } catch {}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

const PIPELINE_STATE_PATH = join(PROJECT_ROOT, 'data', 'pipeline-state.json');
const CONTENT_LOG_PATH = join(PROJECT_ROOT, 'data', 'content-log.json');
const TOPIC_BANK_PATH = join(PROJECT_ROOT, 'data', 'topic-bank.json');
const AGENTS_DIR = join(PROJECT_ROOT, '.claude', 'agents');

const IS_TEST = process.argv.includes('--test') || process.argv.includes('--dry-run');

const anthropic = new Anthropic();

// ============================================================
// 유틸리티 함수
// ============================================================

async function loadJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

async function saveJson(filePath, data) {
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * .claude/agents/*.md 파일에서 에이전트 정의를 로드
 */
async function loadAgentDefinition(agentName) {
  const mdPath = join(AGENTS_DIR, `${agentName}.md`);
  const content = await readFile(mdPath, 'utf-8');

  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) throw new Error(`Invalid agent file: ${agentName}`);

  const frontmatter = {};
  for (const line of fmMatch[1].split('\n')) {
    const m = line.match(/^(\w+):\s*(.+)$/);
    if (m) frontmatter[m[1]] = m[2].trim();
  }

  return {
    name: frontmatter.name,
    description: frontmatter.description,
    model: frontmatter.model || 'sonnet',
    maxTurns: parseInt(frontmatter.maxTurns) || 15,
    systemPrompt: fmMatch[2].trim()
  };
}

function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${ts}] ${msg}`);
}

function logError(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.error(`[${ts}] ❌ ${msg}`);
}

// ============================================================
// Tool 정의 (에이전트에게 제공할 도구들)
// ============================================================

const TOOLS = [
  {
    name: 'read_file',
    description: 'Read a file from the project. Path should be relative to project root.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative file path from project root' }
      },
      required: ['path']
    }
  },
  {
    name: 'write_file',
    description: 'Write content to a file. Path should be relative to project root.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative file path from project root' },
        content: { type: 'string', description: 'Content to write' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'list_files',
    description: 'List files in a directory relative to project root.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative directory path from project root' }
      },
      required: ['path']
    }
  },
  {
    name: 'web_search',
    description: 'Search the web for information. Returns search result summaries.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' }
      },
      required: ['query']
    }
  }
];

// ============================================================
// Tool 실행기
// ============================================================

async function executeTool(toolName, toolInput) {
  try {
    switch (toolName) {
      case 'read_file': {
        const absPath = resolve(PROJECT_ROOT, toolInput.path);
        // 보안: 프로젝트 밖 접근 방지
        if (!absPath.startsWith(PROJECT_ROOT)) {
          return { error: 'Access denied: path outside project root' };
        }
        if (!existsSync(absPath)) {
          return { error: `File not found: ${toolInput.path}` };
        }
        const content = await readFile(absPath, 'utf-8');
        // 큰 파일은 잘라서 반환
        if (content.length > 50000) {
          return { content: content.slice(0, 50000) + '\n... (truncated)' };
        }
        return { content };
      }

      case 'write_file': {
        const absPath = resolve(PROJECT_ROOT, toolInput.path);
        if (!absPath.startsWith(PROJECT_ROOT)) {
          return { error: 'Access denied: path outside project root' };
        }
        await writeFile(absPath, toolInput.content, 'utf-8');
        return { success: true, message: `File written: ${toolInput.path}` };
      }

      case 'list_files': {
        const absPath = resolve(PROJECT_ROOT, toolInput.path);
        if (!absPath.startsWith(PROJECT_ROOT)) {
          return { error: 'Access denied: path outside project root' };
        }
        const entries = await readdir(absPath, { withFileTypes: true });
        const files = entries.map(e => ({
          name: e.name,
          type: e.isDirectory() ? 'directory' : 'file'
        }));
        return { files };
      }

      case 'web_search': {
        // GitHub Actions에서는 실제 웹 검색 API 없이 시뮬레이션
        // 대신 에이전트에게 자신의 지식을 활용하도록 유도
        return {
          note: '웹 검색 결과를 사용할 수 없습니다. 대신 당신의 마케팅 지식을 활용하여 주제를 제안해 주세요.',
          query: toolInput.query,
          results: []
        };
      }

      default:
        return { error: `Unknown tool: ${toolName}` };
    }
  } catch (err) {
    return { error: `Tool execution failed: ${err.message}` };
  }
}

// ============================================================
// 에이전트 실행 함수 (Anthropic Messages API + Tool Use)
// ============================================================

function getModelId(model) {
  switch (model) {
    case 'opus': return 'claude-sonnet-4-20250514';
    case 'haiku': return 'claude-haiku-4-20250414';
    case 'sonnet':
    default: return 'claude-sonnet-4-20250514';
  }
}

/**
 * Anthropic Messages API로 에이전트를 실행 (tool use 루프)
 */
async function runAgent(agentName, taskPrompt) {
  const agent = await loadAgentDefinition(agentName);
  log(`🤖 에이전트 실행: ${agentName} (${agent.model}, maxTurns=${agent.maxTurns})`);

  const modelId = getModelId(agent.model);
  let messages = [{ role: 'user', content: taskPrompt }];
  let turns = 0;

  while (turns < agent.maxTurns) {
    turns++;

    const response = await anthropic.messages.create({
      model: modelId,
      max_tokens: 8192,
      system: agent.systemPrompt,
      tools: TOOLS,
      messages
    });

    // tool_use가 있으면 실행하고 결과 반환
    if (response.stop_reason === 'tool_use') {
      // 어시스턴트 메시지 추가
      messages.push({ role: 'assistant', content: response.content });

      // 모든 tool_use 블록에 대해 결과 생성
      const toolResults = [];
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          const result = await executeTool(block.name, block.input);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result)
          });
        }
      }

      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // end_turn: 에이전트가 작업 완료
    if (response.stop_reason === 'end_turn') {
      const textBlocks = response.content.filter(b => b.type === 'text');
      const result = textBlocks.map(b => b.text).join('\n');
      log(`✅ ${agentName} 완료 (${turns} turns)`);
      return result;
    }

    // max_tokens에 도달한 경우
    if (response.stop_reason === 'max_tokens') {
      log(`⚠️ ${agentName} max_tokens 도달 (${turns} turns)`);
      const textBlocks = response.content.filter(b => b.type === 'text');
      return textBlocks.map(b => b.text).join('\n');
    }

    break;
  }

  log(`⚠️ ${agentName} maxTurns(${agent.maxTurns}) 도달`);
  return '';
}

/**
 * 에이전트 단계 실행 + 검증 + 재시도
 */
async function runStep(stepNum, agentName, taskPrompt, validator, options = {}) {
  const { maxRetries = 1, nonFatal = false, statusLabel } = options;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) log(`🔄 재시도 ${attempt}/${maxRetries}: ${agentName}`);

      await runAgent(agentName, taskPrompt);

      // 검증
      const state = await loadJson(PIPELINE_STATE_PATH);
      const validation = validator(state);

      if (validation.valid) {
        state.currentStep = stepNum;
        if (statusLabel) state.status = statusLabel;
        await saveJson(PIPELINE_STATE_PATH, state);
        return state;
      }

      logError(`Step ${stepNum} 검증 실패: ${validation.error}`);

    } catch (err) {
      logError(`Step ${stepNum} 에이전트 실행 실패: ${err.message}`);
    }

    if (attempt === maxRetries) {
      if (nonFatal) {
        log(`⚠️ Step ${stepNum} 실패 (non-fatal) — 기본값으로 진행`);
        const state = await loadJson(PIPELINE_STATE_PATH);
        state.currentStep = stepNum;
        if (statusLabel) state.status = statusLabel;
        await saveJson(PIPELINE_STATE_PATH, state);
        return state;
      }
      throw new Error(`Step ${stepNum} (${agentName}) 검증 실패 — 재시도 소진`);
    }
  }
}

// ============================================================
// 파이프라인 단계별 구현
// ============================================================

async function step0_initialize() {
  log('========================================');
  log('🚀 캐러셀 콘텐츠 파이프라인 시작');
  log(`📅 ${new Date().toISOString().split('T')[0]}`);
  if (IS_TEST) log('🧪 테스트 모드');
  log('========================================');

  const state = {
    date: new Date().toISOString().split('T')[0],
    status: 'initialized',
    startedAt: new Date().toISOString(),
    currentStep: 0,
    errors: []
  };
  await saveJson(PIPELINE_STATE_PATH, state);

  try {
    log('📊 성과 데이터 수집 중...');
    execSync('node src/collect-insights.js', { cwd: PROJECT_ROOT, stdio: 'pipe' });
    log('✅ 성과 데이터 수집 완료');
  } catch (err) {
    log('⚠️ 성과 데이터 수집 실패 (파이프라인 계속 진행)');
  }
}

async function step1_dataAnalyst() {
  log('\n--- Step 1: 데이터 분석가 ---');
  return runStep(1, 'data-analyst',
    '과거 콘텐츠 성과 데이터를 분석하고, 오늘의 콘텐츠 전략에 대한 인사이트를 제공해 주세요. data/performance-log.json과 data/content-log.json을 read_file 도구로 읽어서 분석한 뒤, 분석 결과를 data/pipeline-state.json의 analystInsights 필드에 write_file 도구로 저장해 주세요. 기존 pipeline-state.json 내용을 먼저 읽고, analystInsights 필드만 추가하여 전체 JSON을 다시 저장하세요.',
    (state) => {
      if (state?.analystInsights) return { valid: true };
      return { valid: false, error: 'analystInsights 필드 없음' };
    },
    { statusLabel: 'analyst-complete' }
  );
}

async function step2_marketResearcher() {
  log('\n--- Step 2: 시장조사원 ---');
  return runStep(2, 'market-researcher',
    '인스타그램 캐러셀 콘텐츠로 만들기 좋은 마케팅 주제 후보 3~5개를 제안해 주세요. 먼저 data/pipeline-state.json을 read_file로 읽어 analystInsights를 참고하고, data/content-log.json에서 최근 30일간 사용된 주제를 확인하여 중복을 피해 주세요. 당신의 마케팅 전문 지식을 활용하여 사람들이 많이 궁금해하는 마케팅 질문/주제를 선택하세요. 결과를 data/pipeline-state.json의 researchResults 필드에 저장해 주세요(topicCandidates 배열 포함, 각 항목에 title, category, keywords, reason 포함). 기존 pipeline-state.json 내용을 먼저 읽고, researchResults 필드만 추가하여 전체 JSON을 다시 저장하세요.',
    (state) => {
      const candidates = state?.researchResults?.topicCandidates;
      if (Array.isArray(candidates) && candidates.length >= 3) return { valid: true };
      return { valid: false, error: `topicCandidates 부족 (${candidates?.length || 0}개)` };
    },
    { statusLabel: 'research-complete' }
  );
}

async function step3_marketingStrategist() {
  log('\n--- Step 3: 마케팅 전략가 ---');
  return runStep(3, 'marketing-strategist',
    '시장조사원이 제안한 주제 후보 중 최적의 주제를 선택하고, 캐러셀 콘텐츠의 전체 구조(콘텐츠 브리프)를 설계해 주세요. data/pipeline-state.json을 read_file로 읽어 analystInsights와 researchResults를 참고하고, data/content-log.json에서 중복을 최종 확인해 주세요. 결과를 data/pipeline-state.json의 contentBrief 필드에 저장해 주세요. contentBrief에는 반드시 selectedTopic(title, category, keywords 포함), slideStructure(7~10장 배열), contentStrategy(format은 반드시 "tips", "story", "stats" 중 하나) 필드가 포함되어야 합니다. 기존 pipeline-state.json 내용을 먼저 읽고, contentBrief 필드만 추가하여 전체 JSON을 다시 저장하세요.',
    (state) => {
      const brief = state?.contentBrief;
      if (!brief?.selectedTopic) return { valid: false, error: 'selectedTopic 없음' };
      if (!Array.isArray(brief?.slideStructure) || brief.slideStructure.length < 7)
        return { valid: false, error: `slideStructure 부족 (${brief?.slideStructure?.length || 0}장)` };
      const validFormats = ['tips', 'story', 'stats'];
      if (!validFormats.includes(brief?.contentStrategy?.format))
        return { valid: false, error: `잘못된 format: ${brief?.contentStrategy?.format}` };
      return { valid: true };
    },
    { statusLabel: 'strategy-complete' }
  );
}

async function step4_copywriter(feedbackPrompt = '') {
  log('\n--- Step 4: 카피라이터 ---');
  const basePrompt = '콘텐츠 브리프를 바탕으로 각 캐러셀 슬라이드의 실제 텍스트를 작성해 주세요. data/pipeline-state.json을 read_file로 읽어 contentBrief를 확인하세요. 각 슬라이드에 대해 slideNumber, headline, body를 포함한 slideContents 배열을 만들어 data/pipeline-state.json에 저장해 주세요. 기존 내용을 먼저 읽고, slideContents 필드만 추가하여 전체 JSON을 다시 저장하세요.';
  const prompt = feedbackPrompt ? `${basePrompt}\n\n${feedbackPrompt}` : basePrompt;

  return runStep(4, 'copywriter', prompt,
    (state) => {
      const slides = state?.slideContents;
      const expected = state?.contentBrief?.slideStructure?.length;
      if (!Array.isArray(slides) || slides.length === 0)
        return { valid: false, error: 'slideContents 없음' };
      if (expected && slides.length !== expected)
        return { valid: false, error: `슬라이드 수 불일치 (${slides.length}/${expected})` };
      for (const s of slides) {
        if (!s.headline || !s.body)
          return { valid: false, error: `슬라이드 ${s.slideNumber}: headline 또는 body 없음` };
      }
      return { valid: true };
    },
    { statusLabel: 'copywriting-complete' }
  );
}

async function step5_contentEditor() {
  log('\n--- Step 5: 콘텐츠 에디터 ---');
  return runStep(5, 'content-editor',
    '카피라이터가 작성한 슬라이드 텍스트를 검토하고 품질을 개선해 주세요. data/pipeline-state.json을 read_file로 읽어 contentBrief와 slideContents를 확인하세요. editedContents 필드에 결과를 저장해 주세요. editedContents에는 slides 배열(각 항목에 slideNumber, headline, body, editNotes), overallQualityScore(1-10), approved(boolean), qualityNotes가 포함되어야 합니다. 기존 내용을 먼저 읽고, editedContents 필드만 추가하여 전체 JSON을 다시 저장하세요.',
    (state) => {
      const edited = state?.editedContents;
      if (!Array.isArray(edited?.slides) || edited.slides.length === 0)
        return { valid: false, error: 'editedContents.slides 없음' };
      if (edited?.overallQualityScore === undefined)
        return { valid: false, error: 'overallQualityScore 없음' };
      return { valid: true };
    },
    { statusLabel: 'editing-complete' }
  );
}

async function step5_withRevision() {
  let state = await step5_contentEditor();

  if (state?.editedContents?.approved === false) {
    log('⚠️ 에디터가 미승인 — 카피라이터 재작성 시작');
    const feedback = state.editedContents.qualityNotes || '';
    const slideNotes = (state.editedContents.slides || [])
      .filter(s => s.editNotes && s.editNotes !== '수정 없음')
      .map(s => `슬라이드 ${s.slideNumber}: ${s.editNotes}`)
      .join('\n');

    const feedbackPrompt = `콘텐츠 에디터의 피드백을 반영하여 슬라이드 텍스트를 수정해 주세요.\n에디터 피드백: ${feedback}\n각 슬라이드 수정 사항:\n${slideNotes}`;

    await step4_copywriter(feedbackPrompt);
    state = await step5_contentEditor();

    if (state?.editedContents?.approved === false) {
      log('⚠️ 2차 에디터도 미승인 — 경고 기록 후 진행');
      state.errors = state.errors || [];
      state.errors.push({ step: 5, message: '에디터 2차 미승인, 현재 콘텐츠로 진행' });
      await saveJson(PIPELINE_STATE_PATH, state);
    }
  }

  return state;
}

async function step6_snsSpecialist() {
  log('\n--- Step 6: SNS 전문가 ---');
  return runStep(6, 'sns-specialist',
    '편집 완료된 캐러셀 콘텐츠에 해시태그, 캡션, 게시 전략을 추가하여 최종 게시 패키지를 완성해 주세요. data/pipeline-state.json을 read_file로 읽어 contentBrief와 editedContents를 확인하세요. finalPackage 필드에 결과를 저장해 주세요. finalPackage에는 caption(string), hashtags(배열, 20~30개), slides(배열), altTexts(배열)가 반드시 포함되어야 합니다. 기존 내용을 먼저 읽고, finalPackage 필드만 추가하여 전체 JSON을 다시 저장하세요.',
    (state) => {
      const pkg = state?.finalPackage;
      if (!pkg?.caption) return { valid: false, error: 'caption 없음' };
      if (!Array.isArray(pkg?.hashtags) || pkg.hashtags.length < 20)
        return { valid: false, error: `해시태그 부족 (${pkg?.hashtags?.length || 0}개)` };
      if (!Array.isArray(pkg?.slides) || pkg.slides.length === 0)
        return { valid: false, error: 'slides 없음' };
      if (!Array.isArray(pkg?.altTexts) || pkg.altTexts.length === 0)
        return { valid: false, error: 'altTexts 없음' };
      return { valid: true };
    },
    { statusLabel: 'packaging-complete' }
  );
}

async function step7_designer() {
  log('\n--- Step 7: 디자이너 ---');
  return runStep(7, 'designer',
    '최종 콘텐츠의 주제, 톤, 텍스트 길이를 분석하여 각 슬라이드에 최적의 비주얼 디자인 지시서를 작성해 주세요. data/pipeline-state.json을 read_file로 읽어 contentBrief와 finalPackage를 확인하세요. designDirective 필드에 결과를 저장해 주세요. designDirective에는 globalStyle 객체와 slideDirectives 배열이 포함되어야 합니다. 기존 내용을 먼저 읽고, designDirective 필드만 추가하여 전체 JSON을 다시 저장하세요.',
    (state) => {
      const dd = state?.designDirective;
      if (!dd?.globalStyle) return { valid: false, error: 'globalStyle 없음' };
      if (!Array.isArray(dd?.slideDirectives) || dd.slideDirectives.length === 0)
        return { valid: false, error: 'slideDirectives 없음' };
      return { valid: true };
    },
    { statusLabel: 'design-complete', nonFatal: true }
  );
}

async function step8_generateImages() {
  log('\n--- Step 8: 이미지 생성 ---');
  const testFlag = IS_TEST ? ' --test' : '';

  for (let attempt = 0; attempt <= 1; attempt++) {
    try {
      if (attempt > 0) log('🔄 이미지 생성 재시도...');
      execSync(`node src/generate-images.js${testFlag}`, {
        cwd: PROJECT_ROOT,
        stdio: 'inherit',
        timeout: 120000
      });

      const state = await loadJson(PIPELINE_STATE_PATH);
      if (Array.isArray(state?.generatedImages) && state.generatedImages.length > 0) {
        state.currentStep = 8;
        state.status = 'images-generated';
        await saveJson(PIPELINE_STATE_PATH, state);
        log(`✅ 이미지 ${state.generatedImages.length}장 생성 완료`);
        return state;
      }
      throw new Error('generatedImages 배열 없음');
    } catch (err) {
      logError(`이미지 생성 실패: ${err.message}`);
      if (attempt === 1) throw err;
    }
  }
}

async function step9_upload() {
  log('\n--- Step 9: Instagram 업로드 ---');
  const testFlag = IS_TEST ? ' --test' : '';

  for (let attempt = 0; attempt <= 1; attempt++) {
    try {
      if (attempt > 0) {
        log('🔄 업로드 재시도 (10초 대기)...');
        await new Promise(r => setTimeout(r, 10000));
      }
      execSync(`node src/upload-instagram.js${testFlag}`, {
        cwd: PROJECT_ROOT,
        stdio: 'inherit',
        timeout: 180000
      });

      const state = await loadJson(PIPELINE_STATE_PATH);
      if (state?.uploadResult) {
        state.currentStep = 9;
        state.status = 'uploaded';
        await saveJson(PIPELINE_STATE_PATH, state);
        log(`✅ 업로드 완료 (postId: ${state.uploadResult.postId || 'N/A'})`);
        return state;
      }
      throw new Error('uploadResult 없음');
    } catch (err) {
      logError(`업로드 실패: ${err.message}`);
      if (attempt === 1) throw err;
    }
  }
}

async function step10_updateRecords() {
  log('\n--- Step 10: 기록 업데이트 ---');
  const state = await loadJson(PIPELINE_STATE_PATH);

  const contentLog = (await loadJson(CONTENT_LOG_PATH)) || [];
  contentLog.push({
    date: state.date,
    topic: state.contentBrief?.selectedTopic?.title,
    category: state.contentBrief?.selectedTopic?.category,
    keywords: state.contentBrief?.selectedTopic?.keywords,
    slideCount: state.finalPackage?.slides?.length,
    format: state.contentBrief?.contentStrategy?.format,
    postId: state.uploadResult?.postId || (IS_TEST ? `test-${state.date.replace(/-/g, '')}` : null)
  });
  await saveJson(CONTENT_LOG_PATH, contentLog);
  log('✅ content-log.json 업데이트 완료');

  const topicBank = (await loadJson(TOPIC_BANK_PATH)) || { recentTopics: [] };
  topicBank.recentTopics = topicBank.recentTopics || [];
  topicBank.recentTopics.push({
    title: state.contentBrief?.selectedTopic?.title,
    category: state.contentBrief?.selectedTopic?.category,
    keywords: state.contentBrief?.selectedTopic?.keywords,
    date: state.date
  });
  if (topicBank.recentTopics.length > 30) {
    topicBank.recentTopics = topicBank.recentTopics.slice(-30);
  }
  await saveJson(TOPIC_BANK_PATH, topicBank);
  log('✅ topic-bank.json 업데이트 완료');

  state.status = 'completed';
  state.completedAt = new Date().toISOString();
  await saveJson(PIPELINE_STATE_PATH, state);

  const elapsed = ((new Date(state.completedAt) - new Date(state.startedAt)) / 60000).toFixed(1);
  console.log('\n========================================');
  console.log('✅ 캐러셀 콘텐츠 생성 완료!');
  console.log(`📌 주제: ${state.contentBrief?.selectedTopic?.title}`);
  console.log(`📊 슬라이드: ${state.finalPackage?.slides?.length}장`);
  console.log(`🎨 포맷: ${state.contentBrief?.contentStrategy?.format}`);
  console.log(`📸 이미지: ${state.generatedImages?.length}장`);
  console.log(`📤 업로드: ${state.uploadResult ? '성공' : '실패'}`);
  console.log(`⏱️ 소요 시간: ${elapsed}분`);
  console.log('========================================');
}

// ============================================================
// 메인 파이프라인 실행
// ============================================================

async function runPipeline() {
  try {
    await step0_initialize();
    await step1_dataAnalyst();
    await step2_marketResearcher();
    await step3_marketingStrategist();
    await step4_copywriter();
    await step5_withRevision();
    await step6_snsSpecialist();
    await step7_designer();
    await step8_generateImages();
    await step9_upload();
    await step10_updateRecords();

  } catch (err) {
    logError(`파이프라인 실패: ${err.message}`);

    try {
      const state = await loadJson(PIPELINE_STATE_PATH) || {};
      state.status = 'failed';
      state.error = err.message;
      state.failedAt = new Date().toISOString();
      state.errors = state.errors || [];
      state.errors.push({ step: state.currentStep, message: err.message, at: new Date().toISOString() });
      await saveJson(PIPELINE_STATE_PATH, state);
    } catch {}

    process.exit(1);
  }
}

runPipeline();

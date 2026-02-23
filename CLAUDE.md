# 인스타그램 캐러셀 콘텐츠 자동화 시스템

## 프로젝트 개요
매일 아침 자동으로 마케팅 주제의 인스타그램 캐러셀 콘텐츠를 생성하고 업로드하는 시스템입니다.
4명의 전문 에이전트가 순차적으로 협업하여 콘텐츠를 제작합니다.

## 기술 스택
- Runtime: Node.js (ES Modules)
- 이미지 생성: Playwright (HTML 템플릿 → 스크린샷)
- 이미지 최적화: Sharp (JPEG, quality 90)
- 이미지 호스팅: imgbb 무료 API
- 커버 이미지: Pexels API (주제 기반 스톡 이미지 자동 검색)
- API: Instagram Graph API v22.0
- 스케줄링: macOS launchd (매일 10:00 AM)

## 파이프라인 실행 순서
```
단계0: 초기화 + 성과 데이터 수집 (collect-insights.js)
단계1: 시장조사원 → 웹에서 인기 마케팅 질문 리서치, 주제 후보 3~5개 제안
단계2: 마케팅 전략가 → 성과 분석 + 최적 주제 선택 + 콘텐츠 브리프 작성
단계3: 카피라이터 → 슬라이드별 텍스트 작성 + 자체 품질 검수
단계4: SNS 전문가 → 해시태그, 캡션, 최종 패키징
단계5: 이미지 생성 (Playwright)
단계6: 인스타그램 업로드 (Graph API)
단계7: 기록 업데이트
```

## 프로젝트 구조
- `.claude/agents/` — 4개 전문 서브에이전트 정의 (시장조사원, 마케팅전략가, 카피라이터, SNS전문가)
- `.claude/skills/create-carousel/` — 파이프라인 오케스트레이션 스킬
- `src/templates/` — HTML/CSS 캐러셀 템플릿 (tips, story, stats)
- `src/generate-images.js` — Playwright 이미지 생성
- `src/upload-instagram.js` — Instagram API 업로드
- `src/collect-insights.js` — 성과 데이터 수집
- `src/utils/` — API 래퍼, 토큰 관리, imgbb 업로더, Pexels API
- `data/` — 파이프라인 상태, 콘텐츠 로그, 성과 로그
- `output/` — 생성된 이미지 (gitignored)
- `scripts/` — 파이프라인 실행 및 스케줄 설정

## 공유 데이터 규약
모든 에이전트는 `data/pipeline-state.json`을 통해 데이터를 주고받습니다.

| 필드 | 작성자 | 설명 |
|------|--------|------|
| `researchResults` | 시장조사원 | 주제 후보 및 리서치 결과 |
| `analystInsights` | 마케팅 전략가 | 성과 분석 인사이트 |
| `contentBrief` | 마케팅 전략가 | 선택된 주제, 슬라이드 구조 (색상 제외) |
| `slideContents` | 카피라이터 | 각 슬라이드 텍스트 |
| `editedContents` | 카피라이터 | 자체 검수 결과, 품질 점수 |
| `finalPackage` | SNS 전문가 | 캡션, 해시태그, 최종 슬라이드 |
| `generatedImages` | generate-images.js | 이미지 파일 경로 배열 |

**규칙**: 각 에이전트는 자신의 지정된 필드에만 쓰고, 이전 단계 데이터는 수정하지 않습니다.

### contentBrief.selectedTopic 형식 주의
마케팅 전략가가 `contentBrief.selectedTopic`을 **문자열**로 저장할 수 있습니다.
코드에서 이 필드를 읽을 때는 반드시 문자열/객체 양쪽을 처리해야 합니다:
```javascript
// 올바른 방법 (문자열과 객체 모두 처리)
const topic = typeof contentBrief?.selectedTopic === 'string'
  ? contentBrief.selectedTopic
  : contentBrief?.selectedTopic?.title || '';

// 잘못된 방법 (문자열일 때 빈 값 반환)
const topic = contentBrief?.selectedTopic?.title || '';  // ❌
```
> **과거 버그**: `selectedTopic`이 문자열일 때 `.title`이 undefined가 되어 Pexels 커버 검색이 스킵되고, 업로드 시 주제가 "(주제 없음)"으로 기록되는 문제가 있었습니다. `generate-images.js`와 `upload-instagram.js`에서 수정 완료.

## 슬라이드 텍스트 형식

### 텍스트 강조 방식 (인라인 하이라이트)
중간 슬라이드는 이어지는 본문 텍스트(body)만 사용하며, 핵심 키워드를 `<hl>` 태그로 강조합니다.
`generate-images.js`에서 `<hl>` → `<span class="text-highlight">`로 변환되어 배경색 하이라이트로 렌더링됩니다.

```
커버 슬라이드 (1번): headline, subtext, emoji
중간 슬라이드 (2~N-1번): body만 사용 (60~100자, <hl> 태그 1~2개)
CTA 슬라이드 (마지막): headline, body, subtext, emoji
```

예시:
```json
{ "slideNumber": 2, "body": "전 세계 <hl>49억 명</hl>이 소셜 미디어를 사용합니다. 고객이 이미 있는 곳에서 비즈니스를 알리세요." }
```

> **중요**: 중간 슬라이드에는 headline, highlight, subtext 필드를 사용하지 않습니다.
> 모든 텍스트는 body 필드 하나에 이어지는 문장으로 작성하고, 강조는 `<hl>` 태그로만 합니다.

## 중복 방지 체계
- `data/content-log.json`에 모든 게시 이력 저장 (주제, 카테고리, 키워드, 날짜)
- 시장조사원: 최근 30일 이력 확인, 키워드 유사도 50% 이상이면 제외, 카테고리 3일 연속 금지
- 마케팅 전략가: 선택 전 최종 중복 검증

## 트렌드 반영 정책
- 시장조사원은 매 실행 시 실시간 트렌드, 밈, 유행 키워드를 조사합니다
- 주제 선정 시 현재 트렌드와 마케팅을 연결할 수 있는 주제를 우선 고려합니다
- 카피라이터는 트렌드 키워드/밈을 자연스럽게 활용하되, 억지로 끼워넣지 않습니다
- SNS 전문가는 실시간 인기 해시태그를 해시태그 믹스에 포함합니다
- 트렌드 데이터는 `researchResults.trendContext`에 저장됩니다
- 데이터 흐름: `시장조사원(trendContext)` → `전략가(trendElements)` → `카피라이터(텍스트 반영)` → `SNS전문가(해시태그+캡션)`

## 커맨드
- `npm run pipeline` — 전체 파이프라인 실행
- `npm run collect-insights` — 성과 데이터 수집만
- `npm run generate-images` — 이미지 생성만
- `npm run upload` — 업로드만
- `npm run test:images` — 이미지 생성 테스트 (샘플 데이터)
- `npm run test:upload` — 업로드 드라이런 (API 호출 로깅만)

## 브랜드 색상 팔레트 (코드 레벨 강제)
모든 캐러셀 콘텐츠는 다음 민트~딥틸 그린 색상 팔레트를 사용합니다:
```
primary:    #51B498  (민트 그린)
secondary:  #17363C  (딥틸)
accent:     #3AA17E  (미드톤 그린)
background: #FAFFFE  (그린 화이트)
text:       #17363C  (딥틸 다크)
```
> **중요**: 이 색상은 `src/generate-images.js`의 `BRAND_COLORS` 상수에서 강제 적용됩니다.
> 에이전트가 다른 색상을 지정하더라도 무시되며, 항상 위 브랜드 색상이 사용됩니다.
> 마케팅 전략가는 `colorScheme` 필드를 출력하지 않습니다.

## 커버 이미지 중복 방지 체계
- `data/used-cover-images.json`에 사용된 Pexels 사진 ID를 모두 기록
- 이미지 생성 시 이전에 사용한 사진 ID를 제외하고 검색
- **한 번 사용된 커버 이미지는 절대 재사용 불가** (Pexels ID 기반 필터링)
- 모든 후보에서 제외된 경우에만 그라데이션 폴백 사용
- 기록 형식: `{ pexelsId, photographer, usedAt, topic }`

## 주의사항
- 모든 콘텐츠는 한국어로 작성됩니다
- 이미지 크기: 1080x1350 (4:5 비율)
- 캐러셀 슬라이드: 7~10장
- 색상은 코드에서 자동 적용됩니다 (에이전트가 변경 불가)
- 커버 슬라이드 배경 이미지는 Pexels API로 주제에 맞는 사진을 자동 검색 (API 키 없으면 그라데이션 폴백)
- **커버 이미지는 이전 게시물과 절대 중복 불가** (`data/used-cover-images.json`으로 관리)
- 커버 이미지 출처는 "Photo by [작가명] / Pexels" 형식으로 하단 우측에 표시
- Instagram API 토큰은 60일마다 자동 갱신 (7일 전 갱신)
- `.env` 파일에 API 자격 증명 저장 (절대 커밋 금지)
- imgbb에 이미지 호스팅 후 공개 URL로 Instagram API에 전달

# 인스타그램 캐러셀 콘텐츠 자동화 시스템

## 프로젝트 개요
매일 아침 자동으로 마케팅 주제의 인스타그램 캐러셀 콘텐츠를 생성하고 업로드하는 시스템입니다.
7명의 전문 에이전트가 순차적으로 협업하여 콘텐츠를 제작합니다.

## 기술 스택
- Runtime: Node.js (ES Modules)
- 이미지 생성: Playwright (HTML 템플릿 → 스크린샷)
- 이미지 최적화: Sharp (JPEG, quality 90)
- 이미지 호스팅: imgbb 무료 API
- 커버 이미지: Pexels API (주제 기반 스톡 이미지 자동 검색)
- API: Instagram Graph API v21.0
- 스케줄링: macOS launchd (매일 10:00 AM)

## 파이프라인 실행 순서
```
단계0: 성과 데이터 수집 (collect-insights.js)
단계1: 데이터 분석가 → 과거 성과 분석, 인사이트 도출
단계2: 시장조사원 → 웹에서 인기 마케팅 질문 리서치, 주제 후보 3~5개 제안
단계3: 마케팅 전략가 → 최적 주제 선택, 콘텐츠 브리프 작성
단계4: 카피라이터 → 슬라이드별 텍스트 작성
단계5: 콘텐츠 에디터 → 품질 검토 및 개선 (7점 미만 시 재작성)
단계6: SNS 전문가 → 해시태그, 캡션, 최종 패키징
단계7: 디자이너 → 슬라이드별 비주얼 스타일 결정 (non-fatal)
단계8: 이미지 생성 (Playwright)
단계9: 인스타그램 업로드 (Graph API)
```

## 프로젝트 구조
- `.claude/agents/` — 7개 전문 서브에이전트 정의
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
| `analystInsights` | 데이터 분석가 | 성과 분석 인사이트 |
| `researchResults` | 시장조사원 | 주제 후보 및 리서치 결과 |
| `contentBrief` | 마케팅 전략가 | 선택된 주제, 슬라이드 구조 (색상 제외) |
| `slideContents` | 카피라이터 | 각 슬라이드 텍스트 |
| `editedContents` | 콘텐츠 에디터 | 검수/수정된 텍스트, 품질 점수 |
| `finalPackage` | SNS 전문가 | 캡션, 해시태그, 최종 슬라이드 |
| `designDirective` | 디자이너 | 레이아웃/배경/숫자/장식 토큰 |
| `generatedImages` | generate-images.js | 이미지 파일 경로 배열 |

**규칙**: 각 에이전트는 자신의 지정된 필드에만 쓰고, 이전 단계 데이터는 수정하지 않습니다.

## 중복 방지 체계
- `data/content-log.json`에 모든 게시 이력 저장 (주제, 카테고리, 키워드, 날짜)
- 시장조사원: 최근 30일 이력 확인, 키워드 유사도 50% 이상이면 제외, 카테고리 3일 연속 금지
- 마케팅 전략가: 선택 전 최종 중복 검증

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

## 주의사항
- 모든 콘텐츠는 한국어로 작성됩니다
- 이미지 크기: 1080x1350 (4:5 비율)
- 캐러셀 슬라이드: 7~10장
- 색상은 코드에서 자동 적용됩니다 (에이전트가 변경 불가)
- 커버 슬라이드 배경 이미지는 Pexels API로 주제에 맞는 사진을 자동 검색 (API 키 없으면 그라데이션 폴백)
- 커버 이미지 출처는 "Photo by [작가명] / Pexels" 형식으로 하단 우측에 표시
- Instagram API 토큰은 60일마다 자동 갱신 (7일 전 갱신)
- `.env` 파일에 API 자격 증명 저장 (절대 커밋 금지)
- imgbb에 이미지 호스팅 후 공개 URL로 Instagram API에 전달

# 인스타그램 캐러셀 콘텐츠 자동 생성 파이프라인

오늘의 인스타그램 캐러셀 콘텐츠를 자동으로 생성하고 업로드합니다. 7명의 전문 에이전트가 순차적으로 협업하여 리서치부터 업로드까지 전체 프로세스를 실행합니다.

## 실행 단계

### 단계 0: 초기화 및 성과 데이터 수집

1. `data/pipeline-state.json`을 초기화합니다:
```json
{
  "date": "오늘 날짜 (YYYY-MM-DD)",
  "status": "initialized",
  "startedAt": "현재 ISO 시간",
  "currentStep": 0
}
```
Write 도구로 위 내용을 `data/pipeline-state.json`에 저장합니다.

2. 이전 게시물 성과 데이터를 수집합니다:
```bash
node src/collect-insights.js
```
- 성공 시: `data/performance-log.json`이 업데이트됩니다
- 실패 시: 경고만 출력하고 계속 진행합니다 (성과 데이터 없이도 파이프라인 진행 가능)

### 단계 1: 데이터 분석가

`data-analyst` 서브에이전트에게 작업을 위임합니다.

위임 프롬프트:
```
과거 콘텐츠 성과 데이터를 분석하고, 오늘의 콘텐츠 전략에 대한 인사이트를 제공해 주세요. data/performance-log.json과 data/content-log.json을 분석하여 data/pipeline-state.json의 analystInsights 필드에 결과를 저장해 주세요.
```

검증: `data/pipeline-state.json`을 읽어 `analystInsights` 필드가 존재하는지 확인합니다.
- `analystInsights`가 없으면: 에러를 기록하고 기본 인사이트로 대체합니다
- `analystInsights`가 있으면: 다음 단계로 진행합니다

`pipeline-state.json`의 `currentStep`을 1로, `status`를 "analyst-complete"로 업데이트합니다.

### 단계 2: 시장조사원

`market-researcher` 서브에이전트에게 작업을 위임합니다.

위임 프롬프트:
```
웹에서 사람들이 많이 묻는 마케팅 질문을 리서치하고, 인스타그램 캐러셀 콘텐츠로 만들기 좋은 주제 후보 3~5개를 제안해 주세요. data/pipeline-state.json의 analystInsights를 참고하고, data/content-log.json에서 최근 30일간 사용된 주제를 확인하여 중복을 피해 주세요. 결과를 data/pipeline-state.json의 researchResults 필드에 저장해 주세요.
```

검증: `data/pipeline-state.json`을 읽어 `researchResults.topicCandidates` 배열이 3개 이상인지 확인합니다.
- 후보가 3개 미만이면: 에러를 기록하고 에이전트를 재실행합니다 (1회 재시도)
- 후보가 3개 이상이면: 다음 단계로 진행합니다

`currentStep`을 2로, `status`를 "research-complete"로 업데이트합니다.

### 단계 3: 마케팅 전략가

`marketing-strategist` 서브에이전트에게 작업을 위임합니다.

위임 프롬프트:
```
시장조사원이 제안한 주제 후보 중 최적의 주제를 선택하고, 캐러셀 콘텐츠의 전체 구조(콘텐츠 브리프)를 설계해 주세요. data/pipeline-state.json의 analystInsights와 researchResults를 참고하고, data/content-log.json에서 중복을 최종 확인해 주세요. 결과를 data/pipeline-state.json의 contentBrief 필드에 저장해 주세요.
```

검증: `data/pipeline-state.json`을 읽어 다음을 확인합니다:
- `contentBrief.selectedTopic`이 존재하는지
- `contentBrief.slideStructure` 배열이 7개 이상인지
- `contentBrief.contentStrategy.format`이 "tips", "story", "stats" 중 하나인지

검증 실패 시 에이전트를 재실행합니다 (1회 재시도).

`currentStep`을 3으로, `status`를 "strategy-complete"로 업데이트합니다.

### 단계 4: 카피라이터

`copywriter` 서브에이전트에게 작업을 위임합니다.

위임 프롬프트:
```
콘텐츠 브리프를 바탕으로 각 캐러셀 슬라이드의 실제 텍스트를 작성해 주세요. data/pipeline-state.json의 contentBrief를 읽고, slideContents 필드에 결과를 저장해 주세요.
```

검증: `data/pipeline-state.json`을 읽어 다음을 확인합니다:
- `slideContents` 배열이 존재하고 `contentBrief.slideStructure`와 같은 수의 슬라이드가 있는지
- 각 슬라이드에 `headline`, `body`, `highlight`, `subtext` 필드가 있는지

검증 실패 시 에이전트를 재실행합니다 (1회 재시도).

`currentStep`을 4로, `status`를 "copywriting-complete"로 업데이트합니다.

### 단계 5: 콘텐츠 에디터

`content-editor` 서브에이전트에게 작업을 위임합니다.

위임 프롬프트:
```
카피라이터가 작성한 슬라이드 텍스트를 검토하고 품질을 개선해 주세요. data/pipeline-state.json의 contentBrief와 slideContents를 읽고, editedContents 필드에 결과를 저장해 주세요.
```

검증: `data/pipeline-state.json`을 읽어 다음을 확인합니다:
- `editedContents.slides` 배열이 존재하는지
- `editedContents.overallQualityScore`가 존재하는지
- `editedContents.approved` 값을 확인

**만약 `editedContents.approved`가 `false`이면:**
1. 에디터의 피드백(`editedContents.qualityNotes`와 각 슬라이드의 `editNotes`)을 확인합니다
2. 카피라이터(단계 4)를 재실행합니다. 이때 위임 프롬프트에 에디터 피드백을 포함합니다:
```
콘텐츠 에디터의 피드백을 반영하여 슬라이드 텍스트를 수정해 주세요.
에디터 피드백: [editedContents.qualityNotes]
각 슬라이드 수정 사항: [각 슬라이드의 editNotes]
data/pipeline-state.json의 contentBrief를 읽고, slideContents 필드를 업데이트해 주세요.
```
3. 에디터(단계 5)를 다시 실행합니다
4. 재실행은 1회만 수행합니다. 2차에도 `approved: false`이면 경고를 기록하고 진행합니다.

`currentStep`을 5로, `status`를 "editing-complete"로 업데이트합니다.

### 단계 6: SNS 전문가

`sns-specialist` 서브에이전트에게 작업을 위임합니다.

위임 프롬프트:
```
편집 완료된 캐러셀 콘텐츠에 해시태그, 캡션, 게시 전략을 추가하여 최종 게시 패키지를 완성해 주세요. data/pipeline-state.json의 contentBrief와 editedContents를 읽고, finalPackage 필드에 결과를 저장해 주세요.
```

검증: `data/pipeline-state.json`을 읽어 다음을 확인합니다:
- `finalPackage.caption`이 존재하는지
- `finalPackage.hashtags` 배열이 20개 이상인지
- `finalPackage.slides` 배열이 존재하는지
- `finalPackage.altTexts` 배열이 존재하는지

검증 실패 시 에이전트를 재실행합니다 (1회 재시도).

`currentStep`을 6으로, `status`를 "packaging-complete"로 업데이트합니다.

### 단계 7: 디자이너

`designer` 서브에이전트에게 작업을 위임합니다.

위임 프롬프트:
```
최종 콘텐츠의 주제, 톤, 텍스트 길이를 분석하여 각 슬라이드에 최적의 비주얼 디자인 지시서를 작성해 주세요. data/pipeline-state.json의 contentBrief와 finalPackage를 읽고, designDirective 필드에 결과를 저장해 주세요.
```

검증: `data/pipeline-state.json`을 읽어 다음을 확인합니다:
- `designDirective.globalStyle`이 존재하는지
- `designDirective.slideDirectives` 배열이 존재하고 비어있지 않은지

**주의: 디자이너 단계 실패는 non-fatal입니다.**
- 검증 실패 시: 경고만 기록하고 다음 단계로 진행합니다 (기본 디자인으로 렌더링)
- 에이전트 실행 자체가 실패해도: 경고만 기록하고 진행합니다

`currentStep`을 7로, `status`를 "design-complete"로 업데이트합니다.

### 단계 8: 이미지 생성

Bash 도구로 이미지 생성 스크립트를 실행합니다:
```bash
node src/generate-images.js
```

검증:
- 스크립트가 정상 종료되었는지 확인합니다 (exit code 0)
- `data/pipeline-state.json`을 읽어 `generatedImages` 배열이 존재하고 비어있지 않은지 확인합니다
- `output/` 디렉토리에 JPEG 파일이 생성되었는지 확인합니다

실패 시 1회 재실행합니다.

`currentStep`을 8로, `status`를 "images-generated"로 업데이트합니다.

### 단계 9: Instagram 업로드

Bash 도구로 업로드 스크립트를 실행합니다:
```bash
node src/upload-instagram.js
```

검증:
- 스크립트가 정상 종료되었는지 확인합니다
- `data/pipeline-state.json`을 읽어 `uploadResult`가 존재하는지 확인합니다

실패 시 1회 재실행합니다.

`currentStep`을 9로, `status`를 "uploaded"로 업데이트합니다.

### 단계 10: 기록 업데이트

1. `data/pipeline-state.json`에서 최종 결과를 읽습니다

2. `data/content-log.json`에 오늘의 콘텐츠 기록을 추가합니다:
```json
{
  "date": "오늘 날짜",
  "topic": "contentBrief.selectedTopic.title",
  "category": "contentBrief.selectedTopic.category",
  "keywords": "contentBrief.selectedTopic.keywords",
  "slideCount": "finalPackage.slides 배열 길이",
  "format": "contentBrief.contentStrategy.format",
  "postId": "uploadResult.postId (업로드 성공 시)"
}
```
Read 도구로 `data/content-log.json`을 읽고, 위 항목을 배열에 추가한 뒤, Write 도구로 저장합니다.

3. `data/topic-bank.json`의 `recentTopics` 배열에 오늘 사용한 주제를 추가합니다. 30개 초과 시 오래된 것부터 제거합니다.

4. `pipeline-state.json`의 `status`를 "completed"로, `completedAt`을 현재 시간으로 업데이트합니다.

5. 최종 요약을 출력합니다:
```
✅ 캐러셀 콘텐츠 생성 완료!
📌 주제: [선택된 주제]
📊 슬라이드: [슬라이드 수]장
🎨 포맷: [tips/story/stats]
📸 이미지: [생성된 이미지 수]장
📤 업로드: [성공/실패]
⏱️ 소요 시간: [시작~완료 시간]
```

## 에러 처리

- 각 단계에서 에이전트 실행 실패 시 1회 재시도합니다
- 재시도 후에도 실패하면 `pipeline-state.json`의 `status`를 "failed"로 설정하고, `error` 필드에 실패 원인을 기록합니다
- 이미지 생성이나 업로드 실패 시에도 에이전트가 생성한 콘텐츠는 `pipeline-state.json`에 보존됩니다
- 모든 에러는 `pipeline-state.json`의 `errors` 배열에 누적 기록합니다

## 테스트 모드

`--test` 또는 `--dry-run` 인자가 전달되면:
- 모든 에이전트는 정상 실행합니다
- 이미지 생성은 `node src/generate-images.js --test`로 실행합니다
- Instagram 업로드는 `node src/upload-instagram.js --test`로 실행합니다 (실제 API 호출 없음)
- 결과는 동일하게 기록하되 `postId`는 "test-YYYYMMDD"로 설정합니다

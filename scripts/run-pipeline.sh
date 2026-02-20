#!/bin/bash
# ============================================================
# 인스타그램 캐러셀 콘텐츠 자동 생성 파이프라인 실행 스크립트
# launchd에 의해 매일 10시에 자동 실행됩니다.
# ============================================================

set -euo pipefail

# 프로젝트 루트 디렉토리
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

# 날짜 변수
DATE=$(date +%Y-%m-%d)
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# 로그 디렉토리 생성
mkdir -p "$PROJECT_DIR/logs"
LOG_FILE="$PROJECT_DIR/logs/pipeline-${DATE}.log"

# 로그 함수
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# macOS 알림 함수
notify() {
    local title="$1"
    local message="$2"
    osascript -e "display notification \"$message\" with title \"$title\"" 2>/dev/null || true
}

# 에러 핸들러
on_error() {
    local exit_code=$?
    log "❌ 파이프라인 실패 (exit code: $exit_code)"
    notify "캐러셀 파이프라인 실패" "오류가 발생했습니다. 로그를 확인하세요."
    exit $exit_code
}
trap on_error ERR

log "=========================================="
log "🚀 캐러셀 콘텐츠 파이프라인 시작"
log "=========================================="

# PATH 설정 (launchd 환경에서는 PATH가 제한적)
export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node/ 2>/dev/null | tail -1)/bin:$PATH"

# Node.js 확인
if ! command -v node &> /dev/null; then
    log "❌ Node.js를 찾을 수 없습니다"
    notify "캐러셀 파이프라인 실패" "Node.js가 설치되어 있지 않습니다."
    exit 1
fi
log "📍 Node.js: $(node --version)"

# Claude CLI 확인
if ! command -v claude &> /dev/null; then
    log "❌ Claude CLI를 찾을 수 없습니다"
    notify "캐러셀 파이프라인 실패" "Claude CLI가 설치되어 있지 않습니다."
    exit 1
fi
log "📍 Claude CLI 확인됨"

# 테스트 모드 확인
TEST_FLAG=""
if [[ "${1:-}" == "--test" ]] || [[ "${1:-}" == "--dry-run" ]]; then
    TEST_FLAG="--test"
    log "🧪 테스트 모드로 실행합니다"
fi

# output 디렉토리 초기화
mkdir -p "$PROJECT_DIR/output"
rm -f "$PROJECT_DIR/output"/*.jpg "$PROJECT_DIR/output"/*.jpeg "$PROJECT_DIR/output"/*.png 2>/dev/null || true
log "📂 output 디렉토리 초기화 완료"

# Claude headless 모드로 파이프라인 실행
log "🤖 Claude 에이전트 파이프라인 시작..."

claude -p "create-carousel 스킬을 실행해 주세요. 오늘의 인스타그램 캐러셀 콘텐츠를 자동으로 생성하고 업로드해 주세요. ${TEST_FLAG:+테스트 모드로 실행해 주세요.}" \
    --allowedTools "Read,Write,Edit,Glob,Grep,Bash,WebFetch,WebSearch,Task" \
    --verbose \
    2>&1 | tee -a "$LOG_FILE"

PIPELINE_EXIT=$?

if [ $PIPELINE_EXIT -eq 0 ]; then
    log "=========================================="
    log "✅ 캐러셀 콘텐츠 파이프라인 완료!"
    log "=========================================="
    notify "캐러셀 콘텐츠 완료" "오늘의 인스타그램 캐러셀이 성공적으로 생성되었습니다!"
else
    log "=========================================="
    log "❌ 파이프라인이 비정상 종료되었습니다 (exit: $PIPELINE_EXIT)"
    log "=========================================="
    notify "캐러셀 파이프라인 실패" "파이프라인 실행 중 오류가 발생했습니다."
    exit $PIPELINE_EXIT
fi

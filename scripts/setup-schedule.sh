#!/bin/bash
# ============================================================
# macOS launchd 스케줄 설정 스크립트
# 매일 오전 10시에 캐러셀 파이프라인을 자동 실행하도록 설정합니다.
# ============================================================

set -euo pipefail

PLIST_LABEL="com.instagram.carousel.automation"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_PATH="$PROJECT_DIR/scripts/run-pipeline.sh"
LOG_DIR="$PROJECT_DIR/logs"

echo "🔧 인스타그램 캐러셀 자동화 스케줄 설정"
echo "=========================================="
echo "프로젝트 경로: $PROJECT_DIR"
echo "스크립트 경로: $SCRIPT_PATH"
echo "실행 시간: 매일 오전 10:00"
echo ""

# 로그 디렉토리 생성
mkdir -p "$LOG_DIR"

# 실행 스크립트 권한 설정
chmod +x "$SCRIPT_PATH"

# 기존 plist가 있으면 언로드
if launchctl list | grep -q "$PLIST_LABEL" 2>/dev/null; then
    echo "⚠️  기존 스케줄이 발견되었습니다. 제거 중..."
    launchctl bootout "gui/$(id -u)/$PLIST_LABEL" 2>/dev/null || \
    launchctl unload "$PLIST_PATH" 2>/dev/null || true
    echo "✅ 기존 스케줄 제거 완료"
fi

# Node.js 경로 탐색
NODE_PATH=$(which node 2>/dev/null || echo "")
if [ -z "$NODE_PATH" ]; then
    echo "❌ Node.js를 찾을 수 없습니다. Node.js를 먼저 설치해 주세요."
    exit 1
fi
NODE_DIR=$(dirname "$NODE_PATH")

# Claude CLI 경로 탐색
CLAUDE_PATH=$(which claude 2>/dev/null || echo "")
if [ -z "$CLAUDE_PATH" ]; then
    echo "❌ Claude CLI를 찾을 수 없습니다. Claude CLI를 먼저 설치해 주세요."
    exit 1
fi
CLAUDE_DIR=$(dirname "$CLAUDE_PATH")

# PATH 구성
COMBINED_PATH="/usr/local/bin:/opt/homebrew/bin:${NODE_DIR}:${CLAUDE_DIR}:/usr/bin:/bin"

echo "📍 Node.js 경로: $NODE_PATH"
echo "📍 Claude CLI 경로: $CLAUDE_PATH"
echo "📍 PATH: $COMBINED_PATH"
echo ""

# launchd plist 생성
cat > "$PLIST_PATH" << PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_LABEL}</string>

    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>${SCRIPT_PATH}</string>
    </array>

    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>10</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>

    <key>WorkingDirectory</key>
    <string>${PROJECT_DIR}</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${COMBINED_PATH}</string>
        <key>HOME</key>
        <string>${HOME}</string>
        <key>LANG</key>
        <string>ko_KR.UTF-8</string>
    </dict>

    <key>StandardOutPath</key>
    <string>${LOG_DIR}/launchd-stdout.log</string>

    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/launchd-stderr.log</string>

    <key>RunAtLoad</key>
    <false/>
</dict>
</plist>
PLIST_EOF

echo "✅ plist 파일 생성 완료: $PLIST_PATH"

# plist 로드
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH" 2>/dev/null || \
launchctl load "$PLIST_PATH" 2>/dev/null || {
    echo "❌ launchd 등록에 실패했습니다."
    echo "수동으로 실행해 주세요: launchctl load $PLIST_PATH"
    exit 1
}

echo "✅ launchd 스케줄 등록 완료!"
echo ""
echo "=========================================="
echo "📋 관리 명령어:"
echo "  즉시 실행 테스트: launchctl start $PLIST_LABEL"
echo "  스케줄 확인:     launchctl list | grep carousel"
echo "  스케줄 제거:     launchctl bootout gui/$(id -u)/$PLIST_LABEL"
echo "  로그 확인:       tail -f $LOG_DIR/pipeline-\$(date +%Y-%m-%d).log"
echo "=========================================="

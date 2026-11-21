#!/usr/bin/env bash
# Start/stop the Vite dev server as a launchd job so it survives
# closing Cursor. `nohup` is not enough: the IDE sends SIGTERM to
# the terminal process tree, which nohup does not ignore.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.daily-focus.dev"
DOMAIN="gui/$(id -u)"
PLIST="$ROOT/.dev-server.plist"
LOG="$ROOT/dev-server.log"
NPM="$(command -v npm)"
NODE_BIN="$(dirname "$(command -v node)")"

usage() {
  echo "Usage: $0 {start|stop|status}" >&2
  exit 1
}

is_loaded() {
  launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1
}

unload() {
  if is_loaded; then
    launchctl bootout "$DOMAIN/$LABEL" >/dev/null 2>&1 || true
  fi
  rm -f "$PLIST"
}

write_plist() {
  mkdir -p "$(dirname "$PLIST")"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>WorkingDirectory</key>
  <string>${ROOT}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NPM}</string>
    <string>run</string>
    <string>dev</string>
    <string>--</string>
    <string>--host</string>
    <string>127.0.0.1</string>
    <string>--port</string>
    <string>5173</string>
    <string>--strictPort</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${NODE_BIN}:/usr/bin:/bin</string>
    <key>HOME</key>
    <string>${HOME}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${LOG}</string>
  <key>StandardErrorPath</key>
  <string>${LOG}</string>
</dict>
</plist>
EOF
}

start() {
  unload
  : > "$LOG"
  write_plist
  launchctl bootstrap "$DOMAIN" "$PLIST"
  for _ in $(seq 1 20); do
    if curl -sf -o /dev/null "http://127.0.0.1:5173/" 2>/dev/null; then
      echo "Daily Focus is running at http://localhost:5173/"
      echo "Parent is launchd, so closing Cursor will not stop it."
      echo "Stop with: npm run dev:stop"
      return 0
    fi
    sleep 0.25
  done
  echo "Started, but http://localhost:5173/ is not responding yet. Check $LOG" >&2
  tail -n 30 "$LOG" >&2 || true
  exit 1
}

stop() {
  unload
  echo "Stopped Daily Focus dev server."
}

status() {
  if is_loaded && curl -sf -o /dev/null "http://127.0.0.1:5173/" 2>/dev/null; then
    echo "running  http://localhost:5173/"
    launchctl print "$DOMAIN/$LABEL" 2>/dev/null | awk '/pid =/{print; exit}'
  elif is_loaded; then
    echo "loaded, but not serving on :5173 — see $LOG"
    exit 1
  else
    echo "stopped"
    exit 1
  fi
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  *) usage ;;
esac

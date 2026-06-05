#!/usr/bin/env bash
set -euo pipefail

HELPER_LABEL="io.github.obgnail.typora-plugin-helper"
DEFAULT_APP="/Applications/Typora.app"
TYPEMARK_REL="Contents/Resources/TypeMark"
INSTALL_ROOT="${HOME}/Library/Application Support/abnerworks.Typora/plugins/typora_plugin"
CONFIG_DIR="${HOME}/.config/typora_plugin"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TYPORA_APP="$DEFAULT_APP"
TYPEMARK_DIR=""

info() { printf '\033[36m[INFO]\033[0m %s\n' "$*"; }
ok() { printf '\033[32m[OK]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[WARN]\033[0m %s\n' "$*"; }
err() { printf '\033[31m[ERROR]\033[0m %s\n' "$*" >&2; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app)
      TYPORA_APP="$2"
      shift 2
      ;;
    --root)
      TYPEMARK_DIR="$2"
      shift 2
      ;;
    *)
      err "Unknown option: $1"
      echo "Usage: $0 [--app /Applications/Typora.app] [--root TypeMark-dir]"
      exit 1
      ;;
  esac
done

if [[ -z "$TYPEMARK_DIR" ]]; then
  TYPEMARK_DIR="${TYPORA_APP}/${TYPEMARK_REL}"
fi

INDEX_FILE="${TYPEMARK_DIR}/index.html"
if [[ ! -f "$INDEX_FILE" ]]; then
  err "Typora TypeMark index.html not found: $INDEX_FILE"
  exit 1
fi

if [[ ! -f "${SCRIPT_DIR}/plugin/macos/entry.bundle.js" ]]; then
  info "macOS bundle not found; building it first"
  (cd "${SCRIPT_DIR}/develop" && npm run build:macos)
fi

NODE_BIN="$(command -v node || true)"
for candidate in "$NODE_BIN" /opt/homebrew/bin/node /usr/local/bin/node; do
  if [[ -n "$candidate" && -x "$candidate" ]]; then
    NODE_BIN="$candidate"
    break
  fi
done
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  err "Node.js >= 22 is required"
  exit 1
fi

info "Installing plugin files to: $INSTALL_ROOT"
mkdir -p "$INSTALL_ROOT" "$CONFIG_DIR"
rsync -a \
  --delete \
  --exclude='.git' \
  --exclude='.DS_Store' \
  --exclude='node_modules' \
  --exclude='*.log' \
  "${SCRIPT_DIR}/plugin/" "${INSTALL_ROOT}/plugin/"

HELPER_PORT="$(python3 - <<'PY'
import socket
s = socket.socket()
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])
s.close()
PY
)"
HELPER_TOKEN="$(openssl rand -hex 32)"
CONNECTION_FILE="${INSTALL_ROOT}/plugin/macos/helper/connection.json"
mkdir -p "$(dirname "$CONNECTION_FILE")"
cat > "$CONNECTION_FILE" <<EOF
{
  "port": ${HELPER_PORT},
  "token": "${HELPER_TOKEN}",
  "pid": null,
  "startedAt": null
}
EOF
chmod 600 "$CONNECTION_FILE"

CONNECTION_SCRIPT="${INSTALL_ROOT}/plugin/macos/helper/connection.js"
cat > "$CONNECTION_SCRIPT" <<EOF
;globalThis.__TP_MACOS_CONNECTION__ = {
  port: ${HELPER_PORT},
  token: "${HELPER_TOKEN}",
  pluginRoot: "${INSTALL_ROOT}"
};
EOF
chmod 600 "$CONNECTION_SCRIPT"

PLIST_DIR="${HOME}/Library/LaunchAgents"
PLIST_FILE="${PLIST_DIR}/${HELPER_LABEL}.plist"
mkdir -p "$PLIST_DIR"
cat > "$PLIST_FILE" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${HELPER_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${INSTALL_ROOT}/plugin/macos/helper/server.js</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>TYPORA_PLUGIN_ROOT</key>
    <string>${INSTALL_ROOT}</string>
    <key>TYPORA_TYPEMARK_ROOT</key>
    <string>${TYPEMARK_DIR}</string>
    <key>TYPORA_HELPER_PORT</key>
    <string>${HELPER_PORT}</string>
    <key>TYPORA_HELPER_TOKEN</key>
    <string>${HELPER_TOKEN}</string>
    <key>TYPORA_HELPER_CONNECTION_FILE</key>
    <string>${CONNECTION_FILE}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${CONFIG_DIR}/helper-stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${CONFIG_DIR}/helper-stderr.log</string>
  <key>WorkingDirectory</key>
  <string>${INSTALL_ROOT}</string>
</dict>
</plist>
EOF

info "Loading helper LaunchAgent"
launchctl unload "$PLIST_FILE" 2>/dev/null || true
launchctl load "$PLIST_FILE"

TYPEMARK_LINK="${TYPEMARK_DIR}/typora-plugin-macos"
if [[ -e "$TYPEMARK_LINK" && ! -L "$TYPEMARK_LINK" ]]; then
  err "Cannot create Typora plugin symlink because path already exists: $TYPEMARK_LINK"
  exit 1
fi
ln -sfn "${INSTALL_ROOT}/plugin/macos" "$TYPEMARK_LINK"
LOADER_FILE="${TYPEMARK_LINK}/loader.js"

info "Injecting loader into Typora index.html"
INJECTION_TARGETS=("$INDEX_FILE")
CONTENT_FILE="${TYPEMARK_DIR}/html/content.html"
if [[ -f "$CONTENT_FILE" ]]; then
  INJECTION_TARGETS+=("$CONTENT_FILE")
fi

python3 - "$LOADER_FILE" "${INJECTION_TARGETS[@]}" <<'PY'
from pathlib import Path
import json
import os
import sys

loader_file = Path(sys.argv[1])
targets = [Path(item) for item in sys.argv[2:]]
marker = 'typora-plugin-macos-loader'
for target in targets:
    loader = os.path.relpath(loader_file, target.parent).replace(os.sep, "/")
    loader_js = json.dumps(loader)
    tag = f'''<script id="{marker}">;(()=>{{const s=document.createElement("script");s.src={loader_js}+(({loader_js}.includes("?")?"&":"?")+"v="+Date.now());s.defer=true;s.onerror=()=>console.error("[typora-plugin] Typora Plugin loader failed: "+s.src);document.head.appendChild(s)}})();</script>'''
    text = target.read_text(encoding='utf-8')
    backup = target.with_suffix(target.suffix + '.typora-plugin.bak')
    if not backup.exists():
        backup.write_text(text, encoding='utf-8')

    lines = [line for line in text.splitlines() if marker not in line]
    text = "\n".join(lines)
    if "</head>" in text:
        text = text.replace("</head>", f"{tag}\n</head>", 1)
    elif "</body>" in text:
        text = text.replace("</body>", f"{tag}\n</body>", 1)
    else:
        text += "\n" + tag + "\n"
    target.write_text(text, encoding='utf-8')
PY

ok "macOS Typora Plugin installed"
echo "Plugin root: $INSTALL_ROOT"
echo "Helper:      127.0.0.1:${HELPER_PORT}"
echo "Logs:        ${CONFIG_DIR}/helper-stderr.log"

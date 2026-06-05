#!/usr/bin/env bash
set -euo pipefail

HELPER_LABEL="io.github.obgnail.typora-plugin-helper"
DEFAULT_APP="/Applications/Typora.app"
TYPEMARK_REL="Contents/Resources/TypeMark"
INSTALL_ROOT="${HOME}/Library/Application Support/abnerworks.Typora/plugins/typora_plugin"

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

PLIST_FILE="${HOME}/Library/LaunchAgents/${HELPER_LABEL}.plist"
if [[ -f "$PLIST_FILE" ]]; then
  info "Stopping helper LaunchAgent"
  launchctl unload "$PLIST_FILE" 2>/dev/null || true
  rm -f "$PLIST_FILE"
fi

INDEX_FILE="${TYPEMARK_DIR}/index.html"
CONTENT_FILE="${TYPEMARK_DIR}/html/content.html"
INJECTION_TARGETS=()
[[ -f "$INDEX_FILE" ]] && INJECTION_TARGETS+=("$INDEX_FILE")
[[ -f "$CONTENT_FILE" ]] && INJECTION_TARGETS+=("$CONTENT_FILE")

if [[ ${#INJECTION_TARGETS[@]} -gt 0 ]]; then
  info "Removing Typora loader injection"
  python3 - "${INJECTION_TARGETS[@]}" <<'PY'
from pathlib import Path
import sys

marker = 'typora-plugin-macos-loader'
for item in sys.argv[1:]:
    path = Path(item)
    text = path.read_text(encoding='utf-8')
    lines = [line for line in text.splitlines() if marker not in line]
    path.write_text("\n".join(lines) + "\n", encoding='utf-8')
PY
else
  warn "Typora injection targets not found; skipping injection cleanup"
fi

TYPEMARK_LINK="${TYPEMARK_DIR}/typora-plugin-macos"
if [[ -L "$TYPEMARK_LINK" ]]; then
  info "Removing Typora plugin symlink"
  rm -f "$TYPEMARK_LINK"
fi

if [[ -d "$INSTALL_ROOT" ]]; then
  info "Removing plugin files from user directory"
  rm -rf "$INSTALL_ROOT"
fi

ok "macOS Typora Plugin uninstalled"
echo "User settings in ~/.config/typora_plugin were preserved."

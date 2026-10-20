#!/bin/sh
# codex-widget-kit installer: clones or updates the kit and links the `codex-widgets` command.
#   curl -fsSL https://raw.githubusercontent.com/MakeItEzzz555/codex-widget-kit/main/install.sh | sh
#   ... | sh -s -- --statusline     also turns on Codex's built-in status line (backs up config.toml first)
#   ... | sh -s -- --uninstall      removes the kit and the link (config.toml is left as is)
set -eu

REPO="${CODEX_WIDGET_KIT_REPO:-https://github.com/MakeItEzzz555/codex-widget-kit.git}"
CODEX_DIR="${CODEX_HOME:-$HOME/.codex}"
DIR="${CODEX_WIDGET_KIT_DIR:-$CODEX_DIR/widget-kit}"
BIN="${CODEX_WIDGET_KIT_BIN:-$HOME/.local/bin}"
CONFIG="$CODEX_DIR/config.toml"

say() { printf '%s\n' "codex-widget-kit: $*"; }

if [ "${1:-}" = "--uninstall" ]; then
  rm -f "$BIN/codex-widgets"
  # only ever delete a folder that is this kit
  [ -f "$DIR/bin/codex-widgets.mjs" ] && rm -rf "$DIR"
  say "removed $DIR and $BIN/codex-widgets"
  exit 0
fi

command -v node >/dev/null 2>&1 || { say "needs Node.js 20 or newer (https://nodejs.org)"; exit 1; }
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' || { say "needs Node.js 20 or newer, found $(node --version)"; exit 1; }
command -v git >/dev/null 2>&1 || { say "needs git"; exit 1; }

if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only --quiet
  say "updated $DIR"
else
  git clone --depth 1 --quiet "$REPO" "$DIR"
  say "installed into $DIR"
fi
chmod +x "$DIR/bin/codex-widgets.mjs"
mkdir -p "$BIN"
ln -sf "$DIR/bin/codex-widgets.mjs" "$BIN/codex-widgets"
say "linked $BIN/codex-widgets"
case ":$PATH:" in *":$BIN:"*) ;; *) say "add $BIN to your PATH to run codex-widgets by name" ;; esac

if [ "${1:-}" = "--statusline" ]; then
  if [ -f "$CONFIG" ] && grep -q '^status_line *=' "$CONFIG"; then
    say "config.toml already sets status_line; left unchanged (see $DIR/config/statusline.toml)"
  else
    BACKUP="$CONFIG.before-widget-kit-$(date +%Y%m%d-%H%M%S)"
    if [ -f "$CONFIG" ]; then cp -p "$CONFIG" "$BACKUP"; else : > "$BACKUP"; fi
    LINES='status_line = ["model-with-reasoning", "task-progress", "context-remaining", "five-hour-limit", "weekly-limit", "run-state", "git-branch"]
status_line_use_colors = true'
    if [ -f "$CONFIG" ] && grep -q '^\[tui\] *$' "$CONFIG"; then
      # insert right under the existing [tui] header so the keys land in that table
      awk -v lines="$LINES" '{ print } /^\[tui\] *$/ && !done { print lines; done = 1 }' "$BACKUP" > "$CONFIG"
    else
      { cat "$BACKUP"; printf '\n[tui]\n%s\n' "$LINES"; } > "$CONFIG"
    fi
    say "turned on Codex's status line; backup at $BACKUP"
    diff -u "$BACKUP" "$CONFIG" || true
  fi
fi

say "done. Run 'codex-widgets' in a second terminal pane in your project folder, then start codex in the first."

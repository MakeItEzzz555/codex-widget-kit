# One-click install prompt

Paste this into Codex CLI, in any folder. Codex installs the kit, checks it and tells you how to open the pane. It asks before it changes your Codex config.

```text
Install Codex Widget Kit (https://github.com/MakeItEzzz555/codex-widget-kit) for me.

1. Check that `node --version` is 20 or newer and `git` exists. If not, stop and tell me what to install.
2. Run: curl -fsSL https://raw.githubusercontent.com/MakeItEzzz555/codex-widget-kit/main/install.sh | sh
3. Verify: run `~/.local/bin/codex-widgets --once --cwd "$PWD"` and show me the output. A frame, or "Waiting for a Codex session in …", both mean it works.
4. Ask me whether to also turn on Codex's built-in status line. Only if I say yes, run:
   curl -fsSL https://raw.githubusercontent.com/MakeItEzzz555/codex-widget-kit/main/install.sh | sh -s -- --statusline
   and show me the diff it prints and the backup path.
5. Tell me how to open the widgets beside Codex in my terminal (tmux: `tmux split-window -h -l 48 codex-widgets`; Ghostty or iTerm2: split with ⌘D and run `codex-widgets`), and whether ~/.local/bin is on my PATH.

Do not edit any other file, do not install global npm packages, and do not start background services.
```

## Shell only

```bash
curl -fsSL https://raw.githubusercontent.com/MakeItEzzz555/codex-widget-kit/main/install.sh | sh
```

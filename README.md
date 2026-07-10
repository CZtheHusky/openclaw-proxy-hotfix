# OpenClaw Proxy Hotfix

Local hotfix tool for restoring OpenClaw proxy behavior after upgrading the
global npm package.

It patches the installed OpenClaw `dist/` files in place and always creates a
backup under `~/.openclaw/hotfix-backups/` before changing anything.

## Install

```bash
cd "/home/caozhe/OneDrive_huskyc/documents/obsidian/papers & talks/Physical Intelligence/openclaw-proxy-hotfix"
./install.sh
```

## Upgrade Workflow

After updating OpenClaw:

```bash
openclaw-proxy-hotfix check
openclaw-proxy-hotfix apply
openclaw-proxy-hotfix verify
```

For a full live model probe that clears shell proxy variables first:

```bash
openclaw-proxy-hotfix verify --full
```

## What It Fixes

- OpenAI ChatGPT/Codex OAuth token exchange uses the configured env proxy.
- `openclaw tui --local`, `openclaw chat`, and `openclaw terminal` start
  OpenClaw's managed proxy when `proxy.enabled=true`.
- The shared Codex app-server client can refresh ChatGPT auth tokens during
  long-lived TUI sessions.

## Restore

Restore the latest backup:

```bash
openclaw-proxy-hotfix restore
```

Restore a specific backup:

```bash
openclaw-proxy-hotfix restore ~/.openclaw/hotfix-backups/<version-timestamp>
```

## Notes

- This tool does not edit Clash config.
- It does not read or print OAuth tokens.
- It finds OpenClaw chunks by content, not hash filenames.
- If OpenClaw's compiled output changes too much, `apply` fails loudly instead
  of guessing.

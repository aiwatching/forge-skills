# Forge Skills Marketplace

Skills and commands for [Forge](https://github.com/aiwatching/forge) — a self-hosted AI workflow platform built on Claude Code.

## What's in here

- **Skills** (`skills/`) — Rich Claude Code skills with `SKILL.md` + supporting files. Installed to `~/.claude/skills/<name>/`
- **Commands** (`commands/`) — Simple slash commands (`.md` files). Installed to `~/.claude/commands/`
- **Registry** (`registry.json`) — Index file that Forge reads to show the marketplace

## Install via Forge

1. Open Forge → Settings → set **Skills Repo** to `aiwatching/forge-skills` (default)
2. Go to Skills page → browse and install with one click

## Browse

| Skills | Commands |
|--------|----------|
| [browse](skills/browse/) — Headless browser for QA testing | [review-code](commands/review-code/) — Code review on git diff |
| [careful](skills/careful/) — Safety guardrails for destructive commands | [explain](commands/explain/) — Explain code logic |
| [qa](skills/qa/) — Automated QA testing + bug fixing | [refactor](commands/refactor/) — Refactoring suggestions |
| [plan-eng-review](skills/plan-eng-review/) — Engineering plan review | [test-gen](commands/test-gen/) — Generate unit tests |
| [cloudflare-manager](skills/cloudflare-manager/) — Cloudflare management | [example-commit](commands/example-commit/) — Smart commit messages |
| [setup-browser-cookies](skills/setup-browser-cookies/) — Import browser cookies | |
| [webmcp](skills/webmcp/) — Web MCP integration | |
| [audit-env-variables](skills/audit-env-variables/) — Audit environment variables | |
| [clean](skills/clean/) — Git cleanup | |

## Structure

```
skills/<name>/
├── info.json          # Metadata (name, description, author, version, tags)
└── SKILL.md           # Skill definition + supporting files

commands/<name>/
├── info.json
└── <name>.md          # Command definition
```

## Contributing

We curate skills from the community. To suggest a skill, open an issue with the source URL.

## License

[Apache 2.0](LICENSE)

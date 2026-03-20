## Forge Skills Marketplace (`aiwatching/forge-skills`)

Skills and commands marketplace for [Forge](https://github.com/aiwatching/forge).

### Structure
```
forge-skills/
├── registry.json        # Forge 消费的入口（自动生成）
├── skills/              # Skills（每个子目录 = 一个 skill）
│   ├── <name>/
│   │   ├── info.json
│   │   ├── SKILL.md
│   │   └── ...
└── commands/            # Commands（每个子目录 = 一个 command）
    ├── <name>/
    │   ├── info.json
    │   └── <name>.md
```

### How Forge consumes this
Forge 通过 raw GitHub URL 拉取 `registry.json`，按需下载 skills/commands 安装到本地：
- Skills → `~/.claude/skills/<name>/`
- Commands → `~/.claude/commands/<name>.md`

### Management
内容由 [forge-skills-manager](https://github.com/aiwatching/forge-skills-manager) 管理和发布。

<!-- forge:template:obsidian-vault -->
## Obsidian Vault
Location: /Users/zliu/MyDocuments/obsidian-project/Projects
When I ask about my notes, use bash to search and read files from the vault directory.
Example: find <vault_path> -name "*.md" | head -20
<!-- /forge:template:obsidian-vault -->

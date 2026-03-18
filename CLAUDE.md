## Project: Forge Skills (`aiwatching/forge-skills`)

Skills marketplace for [Forge](https://github.com/aiwatching/forge) — collection, scoring, and distribution of Claude Code skill files.

### Structure
```
forge-skills/
├── registry.json              # Forge 消费的入口（自动生成，勿手动编辑）
├── skills/                    # 收集到的 skill .md 文件
├── collector/                 # 爬虫 + 评分 + registry 生成
│   ├── crawl.mjs              # GitHub 爬取 .claude/commands/*.md
│   ├── score.mjs              # 评分逻辑
│   └── build-registry.mjs     # 汇总生成 registry.json
├── .github/workflows/
│   └── sync.yaml              # 定时跑 collector
└── sources.yaml               # 爬取源配置
```

### Scripts
```bash
node collector/crawl.mjs           # 爬取 skills
node collector/score.mjs           # 计算评分
node collector/build-registry.mjs  # 生成 registry.json
```

### How Forge consumes this
Forge Settings 配置 GitHub repo URL（默认 `aiwatching/forge-skills`），
Skills 页面通过 raw GitHub URL 拉取 `registry.json`，一键 Install/Remove skill `.md` 文件到 `~/.claude/commands/`。

### Rules
- 当 skills 的目录结构、info.json 字段、registry.json 格式、score 计算逻辑等格式规范发生变更时，必须同步更新 Obsidian 文档：`/Users/zliu/MyDocuments/obsidian-project/Projects/Forge/forge-skills-spec.md`

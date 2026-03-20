## Project: Forge Skills (`aiwatching/forge-skills`)

Skills marketplace for [Forge](https://github.com/aiwatching/forge) — collection, scoring, and distribution of Claude Code skill/command files.

### Structure
```
forge-skills/
├── registry.json              # Forge 消费的入口（自动生成，勿手动编辑）
├── skills/                    # 已发布的 skills（tar.gz + 同名文件夹平级）
├── commands/                  # 已发布的 commands（tar.gz + 同名文件夹平级）
├── staging.json               # 待审核条目（手动添加）
├── sources.json               # 爬取源 repo 列表
├── admin.mjs                  # 管理页面服务
├── start.sh                   # 启动脚本
├── collector/                 # 评分 + registry 生成
│   ├── crawl.mjs              # GitHub 爬取 → staging.json（暂不稳定，待重构）
│   ├── score.mjs              # 评分逻辑
│   └── build-registry.mjs     # 汇总生成 registry.json
└── .github/workflows/
    └── sync.yaml              # 定时跑 collector
```

### Scripts
```bash
./start.sh                         # 启动管理页面 http://localhost:3100
./start.sh 3200                    # 自定义端口
node admin.mjs                     # 管理页面 http://localhost:3100
node admin.mjs --port 3200         # 自定义端口
node collector/crawl.mjs           # 爬取所有 sources 中的 repo
node collector/crawl.mjs --repo owner/repo  # 爬取单个 repo
node collector/score.mjs           # 计算评分
node collector/build-registry.mjs  # 生成 registry.json
```

### How Forge consumes this
Forge Settings 配置 GitHub repo URL（默认 `aiwatching/forge-skills`），
Skills/Commands 页面通过 raw GitHub URL 拉取 `registry.json`，一键下载压缩包并解压安装到本地对应目录：
- Skills → `~/.claude/skills/<name>/`
- Commands → `~/.claude/commands/<name>.md`

### 存储格式
每个 skill/command 以文件夹方式存储，Forge 端通过 GitHub raw URL 直接下载文件夹内容：
```
skills/
├── review-code/
│   ├── info.json           #   元信息
│   ├── SKILL.md
│   └── templates/...
├── explain/
│   ├── info.json
│   └── SKILL.md
└── ...

commands/
├── deploy/
│   ├── info.json
│   └── deploy.md
└── ...
```

### Rules
- 当 skills/commands 的目录结构、info.json 字段、registry.json 格式、score 计算逻辑等格式规范发生变更时，必须同步更新 Obsidian 文档：`/Users/zliu/MyDocuments/obsidian-project/Projects/Forge/forge-skills-spec.md`

#!/usr/bin/env node
// Forge Skills admin — local management UI
// All skills (crawled or manual) go to staging first, then approve → skills/ (published)
// Usage: node admin.mjs [--port 3100]

import { createServer } from "http";
import {
  readFileSync, writeFileSync, mkdirSync, rmSync,
  readdirSync, existsSync, statSync, renameSync,
} from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env if exists
const envPath = join(__dirname, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([^#=]+?)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const SKILLS_DIR = join(__dirname, "skills");
const SOURCES_PATH = join(__dirname, "sources.json");
const STAGING_PATH = join(__dirname, "staging.json");
const PORT = parseInt(process.argv.find((_, i, a) => a[i - 1] === "--port") || "3100");

function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}
function readBody(req) {
  return new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => r(b)); });
}
function listSkills() {
  if (!existsSync(SKILLS_DIR)) return [];
  return readdirSync(SKILLS_DIR)
    .filter((d) => statSync(join(SKILLS_DIR, d)).isDirectory())
    .map((d) => {
      const ip = join(SKILLS_DIR, d, "info.json");
      const sp = join(SKILLS_DIR, d, "skill.md");
      return {
        dir: d,
        info: existsSync(ip) ? JSON.parse(readFileSync(ip, "utf8")) : null,
        content: existsSync(sp) ? readFileSync(sp, "utf8") : "",
      };
    })
    .filter((s) => s.info);
}
function readStaging() {
  return existsSync(STAGING_PATH) ? JSON.parse(readFileSync(STAGING_PATH, "utf8")) : [];
}
function writeStaging(data) {
  writeFileSync(STAGING_PATH, JSON.stringify(data, null, 2) + "\n");
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  // ── Sources ──
  if (p === "/api/sources" && req.method === "GET") {
    const sources = existsSync(SOURCES_PATH) ? JSON.parse(readFileSync(SOURCES_PATH, "utf8")) : { repos: [] };
    return json(res, sources);
  }
  if (p === "/api/sources" && req.method === "POST") {
    // Add a repo
    const { repo } = JSON.parse(await readBody(req));
    if (!repo || !repo.includes("/")) return json(res, { error: "Invalid format. Use owner/repo" }, 400);
    const sources = existsSync(SOURCES_PATH) ? JSON.parse(readFileSync(SOURCES_PATH, "utf8")) : { repos: [] };
    if (sources.repos.includes(repo)) return json(res, { error: "Already added" }, 409);
    sources.repos.push(repo);
    writeFileSync(SOURCES_PATH, JSON.stringify(sources, null, 2) + "\n");
    return json(res, { ok: true }, 201);
  }
  if (p.startsWith("/api/sources/") && req.method === "DELETE") {
    const repo = decodeURIComponent(p.slice("/api/sources/".length));
    const sources = existsSync(SOURCES_PATH) ? JSON.parse(readFileSync(SOURCES_PATH, "utf8")) : { repos: [] };
    sources.repos = sources.repos.filter((r) => r !== repo);
    writeFileSync(SOURCES_PATH, JSON.stringify(sources, null, 2) + "\n");
    return json(res, { ok: true });
  }

  // ── Crawl all ──
  if (p === "/api/crawl" && req.method === "POST") {
    const { execSync } = await import("child_process");
    try {
      const token = process.env.GITHUB_TOKEN || "";
      if (!token) return json(res, { error: "GITHUB_TOKEN env not set — start with: GITHUB_TOKEN=ghp_xxx node admin.mjs" }, 400);
      const out = execSync("node collector/crawl.mjs", {
        cwd: __dirname, stdio: "pipe",
        env: { ...process.env, GITHUB_TOKEN: token },
        timeout: 300000,
      });
      return json(res, { ok: true, output: out.toString() });
    } catch (e) {
      return json(res, { error: e.stderr?.toString() || e.message }, 500);
    }
  }
  // ── Crawl single repo ──
  if (p.startsWith("/api/crawl/") && req.method === "POST") {
    const repo = decodeURIComponent(p.slice("/api/crawl/".length));
    const { execSync } = await import("child_process");
    try {
      const token = process.env.GITHUB_TOKEN || "";
      if (!token) return json(res, { error: "GITHUB_TOKEN env not set" }, 400);
      const out = execSync(`node collector/crawl.mjs --repo "${repo}"`, {
        cwd: __dirname, stdio: "pipe",
        env: { ...process.env, GITHUB_TOKEN: token },
        timeout: 120000,
      });
      return json(res, { ok: true, output: out.toString() });
    } catch (e) {
      return json(res, { error: e.stderr?.toString() || e.message }, 500);
    }
  }

  // ── Staging: list ──
  if (p === "/api/staging" && req.method === "GET") {
    return json(res, readStaging());
  }
  // ── Staging: add manually ──
  if (p === "/api/staging" && req.method === "POST") {
    const item = JSON.parse(await readBody(req));
    const staging = readStaging();
    item.id = item.id || `manual/${item.name}/${Date.now()}`;
    item.status = "pending";
    item.crawled_at = new Date().toISOString();
    staging.push(item);
    writeStaging(staging);
    return json(res, { ok: true }, 201);
  }
  // ── Staging: update fields ──
  if (p.startsWith("/api/staging/") && !p.includes("/approve") && !p.includes("/reject") && req.method === "PUT") {
    const id = decodeURIComponent(p.slice("/api/staging/".length));
    const staging = readStaging();
    const idx = staging.findIndex((s) => s.id === id);
    if (idx === -1) return json(res, { error: "not found" }, 404);
    Object.assign(staging[idx], JSON.parse(await readBody(req)));
    writeStaging(staging);
    return json(res, { ok: true });
  }
  // ── Staging: approve → publish to skills/ + rebuild + git push ──
  if (p.startsWith("/api/staging/") && p.endsWith("/approve") && req.method === "POST") {
    const id = decodeURIComponent(p.slice("/api/staging/".length, -"/approve".length));
    const staging = readStaging();
    const item = staging.find((s) => s.id === id);
    if (!item) return json(res, { error: "not found in staging" }, 404);

    try {
      // 1. Write to skills/
      const dir = join(SKILLS_DIR, item.name);
      mkdirSync(dir, { recursive: true });
      const info = {
        name: item.name,
        display_name: item.display_name,
        description: item.description,
        author: { name: item.author, url: `https://github.com/${item.author}` },
        source: {
          repo: item.source_repo || "aiwatching/forge-skills",
          path: item.source_path || `skills/${item.name}/skill.md`,
          url: item.source_url || `https://github.com/${item.source_repo || "aiwatching/forge-skills"}/blob/main/${item.source_path || "skills/" + item.name + "/skill.md"}`,
        },
        version: item.version || "0.1.0",
        tags: item.tags || [],
        license: item.license || "",
        repo_stars: item.repo_stars || 0,
      };
      writeFileSync(join(dir, "info.json"), JSON.stringify(info, null, 2) + "\n");
      writeFileSync(join(dir, "skill.md"), item.content || "");

      // 2. Rebuild registry
      const { execSync } = await import("child_process");
      execSync("node collector/score.mjs && node collector/build-registry.mjs", {
        cwd: __dirname, stdio: "pipe",
      });

      // 3. Git commit + push
      const skillName = item.display_name || item.name;
      execSync(
        `git add "skills/${item.name}/" registry.json && ` +
        `git commit -m "publish: ${skillName}" && ` +
        `git push`,
        { cwd: __dirname, stdio: "pipe" }
      );

      // 4. Update staging status
      item.status = "approved";
      writeStaging(staging);
      return json(res, { ok: true, message: `Published "${skillName}" and pushed to GitHub` });
    } catch (e) {
      return json(res, { error: e.stderr?.toString() || e.message }, 500);
    }
  }
  // ── Staging: reject ──
  if (p.startsWith("/api/staging/") && p.endsWith("/reject") && req.method === "POST") {
    const id = decodeURIComponent(p.slice("/api/staging/".length, -"/reject".length));
    const staging = readStaging();
    const item = staging.find((s) => s.id === id);
    if (!item) return json(res, { error: "not found" }, 404);
    item.status = "rejected";
    writeStaging(staging);
    return json(res, { ok: true });
  }
  // ── Staging: batch delete ──
  if (p === "/api/staging/batch-delete" && req.method === "POST") {
    const { ids } = JSON.parse(await readBody(req));
    if (!Array.isArray(ids)) return json(res, { error: "ids must be array" }, 400);
    const idSet = new Set(ids);
    writeStaging(readStaging().filter((s) => !idSet.has(s.id)));
    return json(res, { ok: true, deleted: ids.length });
  }
  // ── Staging: batch reject ──
  if (p === "/api/staging/batch-reject" && req.method === "POST") {
    const { ids } = JSON.parse(await readBody(req));
    if (!Array.isArray(ids)) return json(res, { error: "ids must be array" }, 400);
    const idSet = new Set(ids);
    const staging = readStaging();
    for (const s of staging) { if (idSet.has(s.id)) s.status = "rejected"; }
    writeStaging(staging);
    return json(res, { ok: true });
  }
  // ── Staging: delete single ──
  if (p.startsWith("/api/staging/") && req.method === "DELETE") {
    const id = decodeURIComponent(p.slice("/api/staging/".length));
    writeStaging(readStaging().filter((s) => s.id !== id));
    return json(res, { ok: true });
  }

  // ── Skills (published): list ──
  if (p === "/api/skills" && req.method === "GET") {
    return json(res, listSkills());
  }
  // ── Skills: update (edit published) ──
  if (p.startsWith("/api/skills/") && req.method === "PUT") {
    const name = decodeURIComponent(p.slice("/api/skills/".length));
    const dir = join(SKILLS_DIR, name);
    if (!existsSync(dir)) return json(res, { error: "not found" }, 404);
    const data = JSON.parse(await readBody(req));
    const newDir = join(SKILLS_DIR, data.info.name);
    if (data.info.name !== name) {
      if (existsSync(newDir)) return json(res, { error: "target name exists" }, 409);
      renameSync(dir, newDir);
    }
    const targetDir = existsSync(newDir) ? newDir : dir;
    writeFileSync(join(targetDir, "info.json"), JSON.stringify(data.info, null, 2) + "\n");
    writeFileSync(join(targetDir, "skill.md"), data.content || "");
    return json(res, { ok: true });
  }
  // ── Skills: unpublish (move back to staging) ──
  if (p.startsWith("/api/skills/") && p.endsWith("/unpublish") && req.method === "POST") {
    const name = decodeURIComponent(p.slice("/api/skills/".length, -"/unpublish".length));
    const dir = join(SKILLS_DIR, name);
    if (!existsSync(dir)) return json(res, { error: "not found" }, 404);
    try {
      const info = JSON.parse(readFileSync(join(dir, "info.json"), "utf8"));
      const content = existsSync(join(dir, "skill.md")) ? readFileSync(join(dir, "skill.md"), "utf8") : "";

      // Add back to staging as pending
      const staging = readStaging();
      staging.push({
        id: `unpublish/${name}/${Date.now()}`,
        name: info.name,
        display_name: info.display_name,
        description: info.description,
        author: info.author?.name || "",
        source_repo: info.source?.repo || "",
        source_path: info.source?.path || "",
        tags: info.tags || [],
        license: info.license || "",
        repo_stars: info.repo_stars || 0,
        content,
        status: "pending",
        crawled_at: new Date().toISOString(),
      });
      writeStaging(staging);

      rmSync(dir, { recursive: true });

      // Rebuild + git
      const { execSync } = await import("child_process");
      execSync("node collector/score.mjs && node collector/build-registry.mjs", { cwd: __dirname, stdio: "pipe" });
      execSync(
        `git add -A "skills/${name}/" registry.json && ` +
        `git commit -m "unpublish: ${info.display_name || name}" && ` +
        `git push`,
        { cwd: __dirname, stdio: "pipe" }
      );
      return json(res, { ok: true, message: `Unpublished "${info.display_name || name}"` });
    } catch (e) {
      return json(res, { error: e.stderr?.toString() || e.message }, 500);
    }
  }
  // ── Skills: delete (permanently, also from git) ──
  if (p.startsWith("/api/skills/") && req.method === "DELETE") {
    const name = decodeURIComponent(p.slice("/api/skills/".length));
    const dir = join(SKILLS_DIR, name);
    if (!existsSync(dir)) return json(res, { error: "not found" }, 404);
    try {
      rmSync(dir, { recursive: true });
      const { execSync } = await import("child_process");
      execSync("node collector/score.mjs && node collector/build-registry.mjs", { cwd: __dirname, stdio: "pipe" });
      execSync(
        `git add -A "skills/${name}/" registry.json && ` +
        `git commit -m "delete: ${name}" && ` +
        `git push`,
        { cwd: __dirname, stdio: "pipe" }
      );
      return json(res, { ok: true, message: `Deleted "${name}"` });
    } catch (e) {
      return json(res, { error: e.stderr?.toString() || e.message }, 500);
    }
  }

  // ── Rebuild registry ──
  if (p === "/api/rebuild" && req.method === "POST") {
    const { execSync } = await import("child_process");
    try {
      execSync("node collector/score.mjs && node collector/build-registry.mjs", {
        cwd: __dirname, stdio: "pipe",
      });
      return json(res, { ok: true });
    } catch (e) {
      return json(res, { error: e.stderr?.toString() || e.message }, 500);
    }
  }

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(HTML);
});

server.listen(PORT, () => console.log(`admin: http://localhost:${PORT}`));

// ── Background auto-crawl: every 6 hours ──
const AUTO_CRAWL_INTERVAL = 6 * 60 * 60 * 1000; // 6h
async function autoCrawl() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return;
  console.log(`[${new Date().toISOString()}] auto-crawl: starting...`);
  try {
    const { execSync } = await import("child_process");
    const out = execSync("node collector/crawl.mjs", {
      cwd: __dirname, stdio: "pipe",
      env: { ...process.env, GITHUB_TOKEN: token },
      timeout: 300000,
    });
    console.log(`[${new Date().toISOString()}] auto-crawl: done\n${out.toString().trim()}`);
  } catch (e) {
    console.error(`[${new Date().toISOString()}] auto-crawl: error — ${e.stderr?.toString() || e.message}`);
  }
}
setInterval(autoCrawl, AUTO_CRAWL_INTERVAL);
// Run first auto-crawl 30s after startup
if (process.env.GITHUB_TOKEN) setTimeout(autoCrawl, 30000);

// ────────────────────── HTML ──────────────────────
const HTML = /*html*/ `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Forge Skills Admin</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0d1117;color:#e6edf3;padding:20px 24px;max-width:1000px;margin:0 auto}
h1{font-size:20px;margin-bottom:12px;color:#58a6ff}
.tabs{display:flex;gap:0;border-bottom:1px solid #30363d;margin-bottom:16px}
.tab{padding:8px 18px;cursor:pointer;font-size:14px;color:#8b949e;border-bottom:2px solid transparent;transition:.15s}
.tab:hover{color:#e6edf3}
.tab.active{color:#58a6ff;border-bottom-color:#58a6ff}
.tab .badge{background:#30363d;color:#8b949e;padding:1px 7px;border-radius:10px;font-size:11px;margin-left:6px}
.tab.active .badge{background:#1f6feb;color:#fff}
.pane{display:none}
.pane.active{display:block}
button{background:#21262d;color:#e6edf3;border:1px solid #30363d;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:13px}
button:hover{background:#30363d}
button:disabled{opacity:.5;cursor:default}
button.primary{background:#238636;border-color:#2ea043}
button.primary:hover{background:#2ea043}
button.danger{background:#da3633;border-color:#f85149}
button.danger:hover{background:#f85149}
.bar{display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;align-items:center}
.bar-right{margin-left:auto;display:flex;gap:8px}
.search-box{background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:6px;padding:6px 10px;font-size:13px;width:220px}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:12px 14px;margin-bottom:8px}
.card-head{display:flex;justify-content:space-between;align-items:center;gap:8px}
.card-head h3{font-size:14px;color:#58a6ff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.card-body{font-size:13px;color:#8b949e;margin-top:5px}
.card-body pre{background:#0d1117;padding:8px;border-radius:4px;font-size:12px;overflow-x:auto;max-height:200px;margin-top:4px;white-space:pre-wrap;word-break:break-all}
.tags{display:flex;gap:4px;margin-top:5px;flex-wrap:wrap}
.tag{background:#1f6feb22;color:#58a6ff;padding:2px 8px;border-radius:12px;font-size:11px}
.actions{display:flex;gap:5px;flex-shrink:0;align-items:center}
.meta{font-size:12px;color:#8b949e}
.score-badge{background:#1f6feb;color:#fff;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600}
.stars{color:#d29922;font-size:12px}
.status-badge{padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600}
.status-pending{background:#9e6a0333;color:#d29922}
.status-approved{background:#23863633;color:#3fb950}
.status-rejected{background:#da363333;color:#f85149}
.filter-bar{display:flex;gap:8px;margin-bottom:12px}
.filter-btn{padding:4px 12px;font-size:12px;border-radius:14px}
.filter-btn.active{background:#1f6feb;border-color:#1f6feb;color:#fff}
.overlay{position:fixed;inset:0;background:#000a;display:none;justify-content:center;align-items:flex-start;padding-top:50px;z-index:10}
.overlay.open{display:flex}
.modal{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:20px;width:640px;max-height:85vh;overflow-y:auto}
.modal h2{font-size:16px;margin-bottom:14px;color:#e6edf3}
.field{margin-bottom:10px}
.field label{display:block;font-size:12px;color:#8b949e;margin-bottom:4px}
.field input,.field textarea{width:100%;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:6px;padding:8px;font-size:13px;font-family:inherit}
.field textarea{min-height:140px;resize:vertical;font-family:"SF Mono","Fira Code",monospace;font-size:12px}
.field-row{display:flex;gap:10px}
.field-row .field{flex:1}
.modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}
.empty{text-align:center;color:#484f58;padding:40px 0;font-size:14px}
.preview{display:none;margin-top:8px;border-top:1px solid #21262d;padding-top:8px}
.preview.open{display:block}
.preview-label{font-size:11px;color:#58a6ff;margin:6px 0 4px;font-weight:600}
.preview pre{background:#0d1117;padding:10px;border-radius:6px;font-size:12px;overflow-x:auto;max-height:300px;white-space:pre-wrap;word-break:break-word;color:#c9d1d9;font-family:"SF Mono","Fira Code",monospace;line-height:1.5}
.btn-preview{font-size:11px;padding:3px 10px;color:#8b949e;border-color:#21262d}
.link-btn{color:#58a6ff;font-size:11px;text-decoration:none;padding:3px 8px;border:1px solid #21262d;border-radius:6px;display:inline-block}
.link-btn:hover{background:#21262d}
.batch-bar{display:none;gap:8px;align-items:center;padding:8px 12px;background:#161b22;border:1px solid #30363d;border-radius:8px;margin-bottom:10px}
.batch-bar.show{display:flex}
.batch-bar .count{font-size:13px;color:#e6edf3;margin-right:4px}
.card-check{display:flex;align-items:flex-start;gap:10px}
.card-check input[type=checkbox]{margin-top:4px;accent-color:#58a6ff;width:16px;height:16px;cursor:pointer;flex-shrink:0}
</style>
</head>
<body>

<h1>Forge Skills Admin</h1>

<div class="tabs">
  <div class="tab active" onclick="switchTab('sources')">Sources</div>
  <div class="tab" onclick="switchTab('staging')">Staging <span class="badge" id="staging-count">0</span></div>
  <div class="tab" onclick="switchTab('skills')">Published <span class="badge" id="skills-count">0</span></div>
</div>

<!-- ── Sources ── -->
<div class="pane active" id="pane-sources">
  <div class="bar">
    <input class="search-box" id="repo-input" placeholder="owner/repo (e.g. qdhenry/Claude-Command-Suite)" style="width:380px"
      onkeydown="if(event.key==='Enter')addRepo()">
    <button class="primary" onclick="addRepo()">+ Add Repo</button>
    <div class="bar-right">
      <button class="primary" onclick="runCrawl()">Crawl All</button>
    </div>
  </div>
  <div id="sources-list"></div>
  <div id="crawl-output" style="margin-top:10px"></div>
</div>

<!-- ── Staging ── -->
<div class="pane" id="pane-staging">
  <div class="bar">
    <div class="filter-bar" style="margin-bottom:0">
      <button class="filter-btn active" onclick="setFilter('pending',this)">Pending</button>
      <button class="filter-btn" onclick="setFilter('approved',this)">Approved</button>
      <button class="filter-btn" onclick="setFilter('rejected',this)">Rejected</button>
      <button class="filter-btn" onclick="setFilter('all',this)">All</button>
    </div>
    <div class="bar-right">
      <input class="search-box" placeholder="Search..." oninput="stagingSearch=this.value;renderStaging()">
      <button class="primary" onclick="openAddModal()">+ Add Skill</button>
    </div>
  </div>
  <div class="batch-bar" id="batch-bar">
    <input type="checkbox" onchange="toggleSelectAll(this.checked)" id="select-all">
    <span class="count" id="batch-count">0 selected</span>
    <button class="danger" onclick="batchDelete()">Delete Selected</button>
    <button onclick="batchReject()">Reject Selected</button>
  </div>
  <div id="staging-list"></div>
</div>

<!-- ── Published ── -->
<div class="pane" id="pane-skills">
  <div class="bar">
    <span class="meta">已发布到在线库的 skills</span>
    <div class="bar-right">
      <input class="search-box" placeholder="Search..." oninput="skillsSearch=this.value;renderSkills()">
      <button onclick="rebuild()">Rebuild Registry</button>
    </div>
  </div>
  <div id="skills-list"></div>
</div>

<!-- ── Add to Staging Modal ── -->
<div class="overlay" id="add-overlay" onclick="if(event.target===this)closeAddModal()">
  <div class="modal">
    <h2>Add Skill to Staging</h2>
    <div class="field-row">
      <div class="field"><label>Name (kebab-case)</label><input id="a-name"></div>
      <div class="field"><label>Display Name</label><input id="a-display"></div>
    </div>
    <div class="field"><label>Description</label><input id="a-desc"></div>
    <div class="field-row">
      <div class="field"><label>Author</label><input id="a-author" value="aiwatching"></div>
      <div class="field"><label>Version</label><input id="a-version" value="0.1.0"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Tags (comma separated)</label><input id="a-tags"></div>
      <div class="field"><label>License</label><input id="a-license" value="Apache-2.0"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Source Repo</label><input id="a-repo" value="aiwatching/forge-skills"></div>
      <div class="field"><label>Source Path</label><input id="a-path"></div>
    </div>
    <div class="field"><label>skill.md</label><textarea id="a-content"></textarea></div>
    <div class="modal-actions">
      <button onclick="closeAddModal()">Cancel</button>
      <button class="primary" onclick="submitAdd()">Add to Staging</button>
    </div>
  </div>
</div>

<!-- ── Staging Detail Modal ── -->
<div class="overlay" id="staging-overlay" onclick="if(event.target===this)closeStagingModal()">
  <div class="modal">
    <h2 id="staging-modal-title">Skill Detail</h2>
    <input type="hidden" id="s-id">
    <div class="field-row">
      <div class="field"><label>Name</label><input id="s-name"></div>
      <div class="field"><label>Display Name</label><input id="s-display"></div>
    </div>
    <div class="field"><label>Description</label><input id="s-desc"></div>
    <div class="field-row">
      <div class="field"><label>Author</label><input id="s-author"></div>
      <div class="field"><label>Version</label><input id="s-version"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Tags (comma separated)</label><input id="s-tags"></div>
      <div class="field"><label>License</label><input id="s-license"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Source Repo</label><input id="s-repo"></div>
      <div class="field"><label>Source Path</label><input id="s-path"></div>
    </div>
    <div class="field"><label>skill.md</label><textarea id="s-content"></textarea></div>
    <div class="modal-actions">
      <button onclick="closeStagingModal()">Cancel</button>
      <button onclick="saveStagingEdit()">Save</button>
      <button class="danger" onclick="stagingAction('reject')">Reject</button>
      <button class="primary" onclick="stagingAction('approve')">Publish</button>
    </div>
  </div>
</div>

<!-- ── Edit Published Skill Modal ── -->
<div class="overlay" id="edit-overlay" onclick="if(event.target===this)closeEditModal()">
  <div class="modal">
    <h2 id="edit-modal-title">Edit Skill</h2>
    <input type="hidden" id="e-orig-name">
    <div class="field-row">
      <div class="field"><label>Name</label><input id="e-name"></div>
      <div class="field"><label>Display Name</label><input id="e-display"></div>
    </div>
    <div class="field"><label>Description</label><input id="e-desc"></div>
    <div class="field-row">
      <div class="field"><label>Author</label><input id="e-author"></div>
      <div class="field"><label>Version</label><input id="e-version"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Tags (comma separated)</label><input id="e-tags"></div>
      <div class="field"><label>License</label><input id="e-license"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Source Repo</label><input id="e-repo"></div>
      <div class="field"><label>Source URL</label><input id="e-url"></div>
    </div>
    <div class="field"><label>skill.md</label><textarea id="e-content"></textarea></div>
    <div class="modal-actions">
      <button onclick="closeEditModal()">Cancel</button>
      <button class="primary" onclick="saveEdit()">Save</button>
    </div>
  </div>
</div>

<script>
const E = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");

let stagingData = [], skillsData = [];
let stagingFilter = "pending", stagingSearch = "", skillsSearch = "";

function togglePreview(id) {
  const el = E(id);
  if (el) el.classList.toggle("open");
}

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((t, i) => {
    t.classList.toggle("active", ["sources","staging","skills"][i] === name);
  });
  document.querySelectorAll(".pane").forEach((p) => p.classList.remove("active"));
  E("pane-" + name).classList.add("active");
  if (name === "sources") loadSources();
  if (name === "staging") loadStaging();
  if (name === "skills") loadSkills();
}

// ── Sources ──
let sourcesData = { repos: [] };
async function loadSources() {
  sourcesData = await (await fetch("/api/sources")).json();
  renderSources();
}
function renderSources() {
  const el = E("sources-list");
  if (!sourcesData.repos.length) {
    el.innerHTML = '<div class="empty">No repos added yet. Add a GitHub repo above to start collecting skills.</div>';
    return;
  }
  el.innerHTML = sourcesData.repos.map(repo =>
    '<div class="card"><div class="card-head">'
    + '<h3>' + esc(repo) + '</h3>'
    + '<div class="actions">'
    + '<a href="https://github.com/' + esc(repo) + '" target="_blank" style="color:#58a6ff;font-size:12px;text-decoration:none">GitHub</a>'
    + '<button onclick="crawlOne(\\'' + esc(repo) + '\\', this)">Crawl</button>'
    + '<button class="danger" onclick="removeRepo(\\'' + esc(repo) + '\\')">Remove</button>'
    + '</div></div></div>'
  ).join("");
}
async function addRepo() {
  const input = E("repo-input");
  const repo = input.value.trim().replace(/^https?:\\/\\/github\\.com\\//, "").replace(/\\/$/, "");
  if (!repo || !repo.includes("/")) { alert("Format: owner/repo"); return; }
  const r = await fetch("/api/sources", { method: "POST", body: JSON.stringify({ repo }) });
  if (r.status === 409) { alert("Already added"); return; }
  if (!r.ok) { const d = await r.json(); alert(d.error); return; }
  input.value = "";
  loadSources();
}
async function removeRepo(repo) {
  if (!confirm("Remove " + repo + "?")) return;
  await fetch("/api/sources/" + encodeURIComponent(repo), { method: "DELETE" });
  loadSources();
}
async function crawlOne(repo, btn) {
  const orig = btn.textContent;
  btn.textContent = "Crawling..."; btn.disabled = true;
  const r = await fetch("/api/crawl/" + encodeURIComponent(repo), { method: "POST" });
  const d = await r.json();
  btn.textContent = orig; btn.disabled = false;
  const el = E("crawl-output");
  el.innerHTML = '<div class="card"><div class="card-body" style="color:' + (r.ok ? "#3fb950" : "#f85149") + '"><pre>' + esc(r.ok ? (d.output||"Done") : d.error) + '</pre></div></div>';
  loadCounts();
}
async function runCrawl() {
  const el = E("crawl-output");
  el.innerHTML = '<div class="card"><div class="card-body">Crawling ' + sourcesData.repos.length + ' repos...</div></div>';
  const r = await fetch("/api/crawl", { method: "POST" });
  const d = await r.json();
  el.innerHTML = '<div class="card"><div class="card-body" style="color:' + (r.ok ? "#3fb950" : "#f85149") + '"><pre>' + esc(r.ok ? (d.output||"Done") : d.error) + '</pre></div></div>';
  loadCounts();
}

// ── Staging ──
async function loadStaging() {
  stagingData = await (await fetch("/api/staging")).json();
  renderStaging();
  loadCounts();
}
function setFilter(f, btn) {
  stagingFilter = f;
  document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  renderStaging();
}
function matchSearch(item, q) {
  if (!q) return true;
  q = q.toLowerCase();
  return (item.name||"").toLowerCase().includes(q)
    || (item.display_name||"").toLowerCase().includes(q)
    || (item.description||"").toLowerCase().includes(q)
    || (item.source_repo||"").toLowerCase().includes(q)
    || (item.tags||[]).some(t => t.toLowerCase().includes(q));
}
function renderStaging() {
  let filtered = stagingFilter === "all" ? stagingData : stagingData.filter((s) => s.status === stagingFilter);
  filtered = filtered.filter((s) => matchSearch(s, stagingSearch));
  const el = E("staging-list");
  if (!filtered.length) { el.innerHTML = '<div class="empty">' + (stagingSearch ? 'No matches' : 'No ' + stagingFilter + ' items') + '</div>'; return; }
  el.innerHTML = filtered.map((s, idx) => {
    const pid = 'sp-' + idx;
    const infoObj = { name: s.name, display_name: s.display_name, description: s.description, author: s.author, source_repo: s.source_repo, source_path: s.source_path, version: s.version, tags: s.tags, license: s.license, repo_stars: s.repo_stars };
    const ghUrl = s.github_url || (s.source_repo ? 'https://github.com/' + s.source_repo + '/blob/main/' + (s.source_path || '') : '');
    const repoUrl = s.repo_url || (s.source_repo ? 'https://github.com/' + s.source_repo : '');
    return '<div class="card"><div class="card-check"><input type="checkbox" value="' + esc(s.id) + '" onchange="updateBatchBar()">'
    + '<div style="flex:1;min-width:0"><div class="card-head"><div>'
    + '<h3>' + esc(s.display_name || s.name) + '</h3>'
    + '</div><div class="actions">'
    + (s.repo_stars ? '<span class="stars">★ ' + s.repo_stars + '</span>' : '')
    + (ghUrl ? '<a href="' + esc(ghUrl) + '" target="_blank" class="link-btn">File</a>' : '')
    + (repoUrl ? '<a href="' + esc(repoUrl) + '" target="_blank" class="link-btn">Repo</a>' : '')
    + '<span class="status-badge status-' + s.status + '">' + s.status + '</span>'
    + '<button class="btn-preview" onclick="togglePreview(\\'' + pid + '\\')">Preview</button>'
    + '<button onclick="openStagingDetail(\\'' + esc(s.id) + '\\')">Edit</button>'
    + (s.status === "pending" ? '<button class="primary" onclick="quickApprove(\\'' + esc(s.id) + '\\')">Publish</button>' : '')
    + (s.status === "pending" ? '<button class="danger" onclick="quickReject(\\'' + esc(s.id) + '\\')">Reject</button>' : '')
    + '<button style="font-size:11px;padding:4px 8px" onclick="delStaging(\\'' + esc(s.id) + '\\')">×</button>'
    + '</div></div>'
    + '<div class="card-body">' + esc(s.source_repo || "manual") + ' · ' + esc(s.source_path || s.name)
    + (s.description ? '<br>' + esc(s.description) : '')
    + '</div>'
    + (s.tags?.length ? '<div class="tags">' + s.tags.map(t => '<span class="tag">' + esc(t) + '</span>').join("") + '</div>' : '')
    + '<div class="preview" id="' + pid + '">'
    + '<div class="preview-label">info.json</div>'
    + '<pre>' + esc(JSON.stringify(infoObj, null, 2)) + '</pre>'
    + '<div class="preview-label">skill.md</div>'
    + '<pre>' + esc(s.content || "(empty)") + '</pre>'
    + '</div>'
    + '</div></div></div>';
  }).join("");
  updateBatchBar();
}

// Batch operations
function getSelectedIds() {
  return [...document.querySelectorAll('#staging-list input[type=checkbox]:checked')].map(c => c.value);
}
function updateBatchBar() {
  const ids = getSelectedIds();
  const bar = E("batch-bar");
  bar.classList.toggle("show", ids.length > 0);
  E("batch-count").textContent = ids.length + " selected";
}
function toggleSelectAll(checked) {
  document.querySelectorAll('#staging-list input[type=checkbox]').forEach(c => c.checked = checked);
  updateBatchBar();
}
async function batchDelete() {
  const ids = getSelectedIds();
  if (!ids.length) return;
  if (!confirm("Delete " + ids.length + " items from staging?")) return;
  await fetch("/api/staging/batch-delete", { method: "POST", body: JSON.stringify({ ids }) });
  E("select-all").checked = false;
  loadStaging();
}
async function batchReject() {
  const ids = getSelectedIds();
  if (!ids.length) return;
  if (!confirm("Reject " + ids.length + " items?")) return;
  await fetch("/api/staging/batch-reject", { method: "POST", body: JSON.stringify({ ids }) });
  E("select-all").checked = false;
  loadStaging();
}

// Add to staging
function openAddModal() {
  E("a-name").value = ""; E("a-display").value = ""; E("a-desc").value = "";
  E("a-author").value = "aiwatching"; E("a-version").value = "0.1.0";
  E("a-tags").value = ""; E("a-license").value = "Apache-2.0";
  E("a-repo").value = "aiwatching/forge-skills"; E("a-path").value = "";
  E("a-content").value = "";
  E("add-overlay").classList.add("open");
}
function closeAddModal() { E("add-overlay").classList.remove("open"); }
async function submitAdd() {
  const name = E("a-name").value.trim();
  if (!name) { alert("Name is required"); return; }
  const item = {
    name,
    display_name: E("a-display").value.trim() || name.replace(/[-_]/g, " ").replace(/\\b\\w/g, c => c.toUpperCase()),
    description: E("a-desc").value.trim(),
    author: E("a-author").value.trim(),
    version: E("a-version").value.trim(),
    source_repo: E("a-repo").value.trim(),
    source_path: E("a-path").value.trim() || ("skills/" + name + "/skill.md"),
    tags: E("a-tags").value.split(",").map(t => t.trim()).filter(Boolean),
    license: E("a-license").value.trim(),
    content: E("a-content").value,
  };
  await fetch("/api/staging", { method: "POST", body: JSON.stringify(item) });
  closeAddModal();
  loadStaging();
}

// Staging detail
function openStagingDetail(id) {
  const s = stagingData.find((x) => x.id === id);
  if (!s) return;
  E("staging-modal-title").textContent = s.display_name || s.name;
  E("s-id").value = s.id;
  E("s-name").value = s.name || "";
  E("s-display").value = s.display_name || "";
  E("s-desc").value = s.description || "";
  E("s-author").value = s.author || "";
  E("s-version").value = s.version || "0.1.0";
  E("s-tags").value = (s.tags || []).join(", ");
  E("s-license").value = s.license || "";
  E("s-repo").value = s.source_repo || "";
  E("s-path").value = s.source_path || "";
  E("s-content").value = s.content || "";
  E("staging-overlay").classList.add("open");
}
function closeStagingModal() { E("staging-overlay").classList.remove("open"); }
async function saveStagingEdit() {
  const id = E("s-id").value;
  await fetch("/api/staging/" + encodeURIComponent(id), {
    method: "PUT",
    body: JSON.stringify({
      name: E("s-name").value.trim(),
      display_name: E("s-display").value.trim(),
      description: E("s-desc").value.trim(),
      author: E("s-author").value.trim(),
      version: E("s-version").value.trim(),
      tags: E("s-tags").value.split(",").map(t => t.trim()).filter(Boolean),
      license: E("s-license").value.trim(),
      source_repo: E("s-repo").value.trim(),
      source_path: E("s-path").value.trim(),
      content: E("s-content").value,
    }),
  });
  closeStagingModal();
  loadStaging();
}
async function stagingAction(action) {
  const id = E("s-id").value;
  const r = await fetch("/api/staging/" + encodeURIComponent(id) + "/" + action, { method: "POST" });
  const d = await r.json();
  closeStagingModal();
  if (!r.ok) { alert("Error: " + (d.error || "unknown")); }
  else if (d.message) { alert(d.message); }
  loadStaging();
  loadCounts();
}
async function quickApprove(id) {
  if (!confirm("Publish this skill? (writes to skills/ + git push)")) return;
  const btn = event.target; btn.textContent = "Publishing..."; btn.disabled = true;
  const r = await fetch("/api/staging/" + encodeURIComponent(id) + "/approve", { method: "POST" });
  const d = await r.json();
  btn.textContent = "Publish"; btn.disabled = false;
  if (!r.ok) { alert("Error: " + (d.error || "unknown")); }
  else if (d.message) { alert(d.message); }
  loadStaging();
  loadCounts();
}
async function quickReject(id) {
  await fetch("/api/staging/" + encodeURIComponent(id) + "/reject", { method: "POST" });
  loadStaging();
  loadCounts();
}
async function delStaging(id) {
  if (!confirm("Remove from staging?")) return;
  await fetch("/api/staging/" + encodeURIComponent(id), { method: "DELETE" });
  loadStaging();
}

// ── Published Skills ──
async function loadSkills() {
  skillsData = await (await fetch("/api/skills")).json();
  renderSkills();
  loadCounts();
}
function renderSkills() {
  let list = skillsData;
  if (skillsSearch) {
    const q = skillsSearch.toLowerCase();
    list = list.filter(s => matchSearch({ ...s.info, tags: s.info.tags }, q));
  }
  const el = E("skills-list");
  if (!list.length) { el.innerHTML = '<div class="empty">' + (skillsSearch ? 'No matches' : 'No published skills. Approve items from Staging to publish.') + '</div>'; return; }
  el.innerHTML = list.map((s, idx) => {
    const i = s.info;
    const pid = 'pp-' + idx;
    const tags = (i.tags||[]).map(t => '<span class="tag">' + esc(t) + '</span>').join("");
    const ghUrl = i.source?.url || '';
    const repoUrl = i.source?.repo ? 'https://github.com/' + i.source.repo : '';
    return '<div class="card"><div class="card-head"><div><h3>' + esc(i.display_name||i.name) + '</h3></div><div class="actions">'
      + (i.score != null ? '<span class="score-badge">' + i.score + '</span>' : '')
      + '<span class="meta">v' + esc(i.version||"") + '</span>'
      + (ghUrl ? '<a href="' + esc(ghUrl) + '" target="_blank" class="link-btn">File</a>' : '')
      + (repoUrl ? '<a href="' + esc(repoUrl) + '" target="_blank" class="link-btn">Repo</a>' : '')
      + '<button class="btn-preview" onclick="togglePreview(\\'' + pid + '\\')">Preview</button>'
      + '<button onclick="openEditModal(\\'' + esc(s.dir) + '\\')">Edit</button>'
      + '<button onclick="unpublish(\\'' + esc(s.dir) + '\\')">Unpublish</button>'
      + '<button class="danger" onclick="delSkill(\\'' + esc(s.dir) + '\\')">Delete</button>'
      + '</div></div>'
      + '<div class="card-body">' + esc(i.source?.repo || "") + ' · ' + esc(i.description||"") + '</div>'
      + (tags ? '<div class="tags">' + tags + '</div>' : '')
      + '<div class="preview" id="' + pid + '">'
      + '<div class="preview-label">info.json</div>'
      + '<pre>' + esc(JSON.stringify(i, null, 2)) + '</pre>'
      + '<div class="preview-label">skill.md</div>'
      + '<pre>' + esc(s.content || "(empty)") + '</pre>'
      + '</div>'
      + '</div>';
  }).join("");
}

function openEditModal(dir) {
  const s = skillsData.find(x => x.dir === dir);
  if (!s) return;
  const i = s.info;
  E("edit-modal-title").textContent = "Edit: " + (i.display_name || i.name);
  E("e-orig-name").value = dir;
  E("e-name").value = i.name || "";
  E("e-display").value = i.display_name || "";
  E("e-desc").value = i.description || "";
  E("e-author").value = i.author?.name || "";
  E("e-version").value = i.version || "";
  E("e-tags").value = (i.tags||[]).join(", ");
  E("e-license").value = i.license || "";
  E("e-repo").value = i.source?.repo || "";
  E("e-url").value = i.source?.url || "";
  E("e-content").value = s.content || "";
  E("edit-overlay").classList.add("open");
}
function closeEditModal() { E("edit-overlay").classList.remove("open"); }
async function saveEdit() {
  const origName = E("e-orig-name").value;
  const name = E("e-name").value.trim();
  if (!name) { alert("Name is required"); return; }
  const info = {
    name,
    display_name: E("e-display").value.trim(),
    description: E("e-desc").value.trim(),
    author: { name: E("e-author").value.trim(), url: "https://github.com/" + E("e-author").value.trim() },
    source: {
      repo: E("e-repo").value.trim(),
      path: "skills/" + name + "/skill.md",
      url: E("e-url").value.trim() || ("https://github.com/" + E("e-repo").value.trim() + "/blob/main/skills/" + name + "/skill.md"),
    },
    version: E("e-version").value.trim(),
    tags: E("e-tags").value.split(",").map(t => t.trim()).filter(Boolean),
    license: E("e-license").value.trim(),
  };
  await fetch("/api/skills/" + encodeURIComponent(origName), {
    method: "PUT", body: JSON.stringify({ info, content: E("e-content").value }),
  });
  closeEditModal();
  loadSkills();
}

async function unpublish(dir) {
  if (!confirm("Unpublish " + dir + "? It will be moved back to staging.")) return;
  await fetch("/api/skills/" + encodeURIComponent(dir) + "/unpublish", { method: "POST" });
  loadSkills();
}
async function delSkill(dir) {
  if (!confirm("Permanently delete " + dir + "?")) return;
  await fetch("/api/skills/" + encodeURIComponent(dir), { method: "DELETE" });
  loadSkills();
}

async function rebuild() {
  const r = await fetch("/api/rebuild", { method: "POST" });
  if (r.ok) { alert("Registry rebuilt"); loadSkills(); }
  else { const d = await r.json(); alert("Error: " + d.error); }
}

async function loadCounts() {
  try {
    const [st, sk] = await Promise.all([fetch("/api/staging").then(r=>r.json()), fetch("/api/skills").then(r=>r.json())]);
    E("staging-count").textContent = st.filter(s => s.status === "pending").length;
    E("skills-count").textContent = sk.length;
  } catch {}
}

loadSources();
loadCounts();
</script>
</body>
</html>`;

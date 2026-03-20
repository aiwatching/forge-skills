#!/usr/bin/env node
// Forge Skills admin — manages skills/ and commands/ with tar.gz + folder format
// Usage: node admin.mjs [--port 3100]

import { createServer } from "http";
import {
  readFileSync, writeFileSync, mkdirSync, rmSync,
  readdirSync, existsSync, statSync, renameSync,
} from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync, spawn } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env
const envPath = join(__dirname, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([^#=]+?)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const SKILLS_DIR = join(__dirname, "skills");
const COMMANDS_DIR = join(__dirname, "commands");
const SOURCES_PATH = join(__dirname, "sources.json");
const STAGING_PATH = join(__dirname, "staging.json");
const ADAPTERS_DIR = join(__dirname, "collector", "adapters");
const PORT = parseInt(process.argv.find((_, i, a) => a[i - 1] === "--port") || "3100");

// Track running analyze processes
const analyzingProcesses = new Map();

// ── Logging ──
const LOGS_PATH = join(__dirname, "logs.json");
function readLogs() {
  return existsSync(LOGS_PATH) ? JSON.parse(readFileSync(LOGS_PATH, "utf8")) : [];
}
function appendLog(sourceId, action, status, message) {
  const logs = readLogs();
  logs.unshift({ source_id: sourceId, action, status, message, time: new Date().toISOString() });
  // Keep last 500 entries
  if (logs.length > 500) logs.length = 500;
  writeFileSync(LOGS_PATH, JSON.stringify(logs, null, 2) + "\n");
  console.log(`[${action}] ${sourceId}: ${status} — ${message}`);
}

// ── Sources helpers ──
function readSources() {
  if (!existsSync(SOURCES_PATH)) return { sources: [] };
  const raw = JSON.parse(readFileSync(SOURCES_PATH, "utf8"));
  // Migrate old format {repos:[]} → {sources:[]}
  if (raw.repos && !raw.sources) {
    const sources = raw.repos.map((r) => ({
      id: r.replace(/\//g, "-"),
      url: `https://github.com/${r}`,
      type: "github",
      name: r.split("/")[1] || r,
      adapter: null,
      adapter_status: "none",
      last_sync: null,
      last_sync_count: 0,
      added_at: new Date().toISOString(),
    }));
    const migrated = { sources };
    writeFileSync(SOURCES_PATH, JSON.stringify(migrated, null, 2) + "\n");
    return migrated;
  }
  return raw;
}
function writeSources(data) {
  writeFileSync(SOURCES_PATH, JSON.stringify(data, null, 2) + "\n");
}
function sourceIdFromUrl(url) {
  return url.replace(/^https?:\/\//, "").replace(/[^a-zA-Z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}

function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}
function readBody(req) {
  return new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => r(b)); });
}

// Flat file list for preview
function readDirFiles(dirPath, rel = "") {
  const files = [];
  if (!existsSync(dirPath)) return files;
  for (const f of readdirSync(dirPath)) {
    const full = join(dirPath, f);
    const relPath = rel ? `${rel}/${f}` : f;
    if (statSync(full).isDirectory()) {
      files.push(...readDirFiles(full, relPath));
    } else {
      try { files.push({ name: f, relPath, content: readFileSync(full, "utf8") }); }
      catch { files.push({ name: f, relPath, content: "(binary)" }); }
    }
  }
  return files;
}

// Tree structure for file explorer
function readDirTree(dirPath) {
  if (!existsSync(dirPath)) return [];
  return readdirSync(dirPath).sort().map((f) => {
    const full = join(dirPath, f);
    if (statSync(full).isDirectory()) {
      return { name: f, type: "dir", children: readDirTree(full) };
    }
    let content;
    try { content = readFileSync(full, "utf8"); } catch { content = "(binary)"; }
    return { name: f, type: "file", size: statSync(full).size, content };
  });
}

function listPublished(baseDir) {
  if (!existsSync(baseDir)) return [];
  return readdirSync(baseDir)
    .filter((d) => statSync(join(baseDir, d)).isDirectory() && existsSync(join(baseDir, d, "info.json")))
    .map((d) => {
      const info = JSON.parse(readFileSync(join(baseDir, d, "info.json"), "utf8"));
      const tree = readDirTree(join(baseDir, d));
      return { dir: d, info, tree };
    });
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

  // ── Sources: list ──
  if (p === "/api/sources" && req.method === "GET") {
    return json(res, readSources());
  }
  // ── Sources: add ──
  if (p === "/api/sources" && req.method === "POST") {
    const body = JSON.parse(await readBody(req));
    let url = body.url || body.repo || "";
    // Normalize: if bare owner/repo, make it a GitHub URL
    if (url && !url.startsWith("http")) url = `https://github.com/${url}`;
    url = url.replace(/\/+$/, "");
    if (!url) return json(res, { error: "URL required" }, 400);

    const id = sourceIdFromUrl(url);
    const type = url.includes("github.com") ? "github" : "web";
    const name = body.name || (type === "github" ? url.split("/").pop() : url.replace(/^https?:\/\//, "").split("/")[0]);

    const sources = readSources();
    if (sources.sources.find((s) => s.id === id)) return json(res, { error: "Already added" }, 409);
    sources.sources.push({
      id, url, type, name,
      adapter: null, adapter_status: "none",
      last_sync: null, last_sync_count: 0,
      added_at: new Date().toISOString(),
    });
    writeSources(sources);
    return json(res, { ok: true, id }, 201);
  }
  // ── Sources: delete ──
  if (p.startsWith("/api/sources/") && !p.includes("/analyze") && !p.includes("/sync") && !p.includes("/adapter") && req.method === "DELETE") {
    const id = decodeURIComponent(p.slice("/api/sources/".length));
    const sources = readSources();
    const src = sources.sources.find((s) => s.id === id);
    sources.sources = sources.sources.filter((s) => s.id !== id);
    writeSources(sources);
    // Clean up adapter file
    if (src?.adapter) {
      const fp = join(ADAPTERS_DIR, src.adapter);
      if (existsSync(fp)) rmSync(fp);
    }
    return json(res, { ok: true });
  }
  // ── Sources: analyze (spawn claude to generate adapter) ──
  if (p.match(/^\/api\/sources\/[^/]+\/analyze$/) && req.method === "POST") {
    const id = decodeURIComponent(p.split("/")[3]);
    const sources = readSources();
    const src = sources.sources.find((s) => s.id === id);
    if (!src) return json(res, { error: "source not found" }, 404);
    if (analyzingProcesses.has(id)) return json(res, { error: "already analyzing" }, 409);

    src.adapter_status = "generating";
    writeSources(sources);

    const adapterFile = `${id}.mjs`;
    const adapterPath = join(ADAPTERS_DIR, adapterFile);
    mkdirSync(ADAPTERS_DIR, { recursive: true });

    const prompt = `You are writing a Node.js ESM adapter script for a skills/commands marketplace crawler.

Source URL: ${src.url}
Source type: ${src.type}

IMPORTANT — type detection rules:
- type="skill" → files found under .claude/skills/ directory, or the repo explicitly organizes content as skills (directories with SKILL.md)
- type="command" → files found under .claude/commands/ directory, or standalone .md files that are slash commands (single markdown files with instructions/prompts)
- If the source contains .claude/commands/*.md files → these are ALL type="command"
- If the source has a "commands" directory → type="command"
- If the source has a "skills" directory with SKILL.md files → type="skill"
- When in doubt, if it's a single .md file with a prompt/instruction → type="command"

Your job:
1. Examine the source at the URL above. If it's a GitHub repo, use the GitHub API (fetch with Authorization header from opts.token). If it's a website, fetch and parse the HTML/JSON.
2. Figure out where skills or commands (.md files) are located and how they're structured.
3. Determine the correct type for each item based on the rules above.
4. Write a complete Node.js ESM module that:
   - Exports a default async function crawl(opts)
   - opts.token is a GitHub API token (if needed)
   - opts.existingIds is a Set of already-known IDs to skip
   - Returns an array of items, each with: { id, name, display_name, description, type ("skill"|"command"), author, files: [{name, relPath, content}], file_count, and optionally source_repo, github_url, tags }
   - Uses only Node.js built-ins (fetch, fs, path, url) — no npm packages
   - Handles pagination if needed
   - Skips items whose id is in opts.existingIds
   - Sets type correctly based on where/how the files are organized

Return ONLY the JavaScript code. No markdown fences, no explanation, no comments outside the code.`;

    // Spawn claude CLI in background
    const child = spawn("claude", ["-p", prompt, "--output-format", "json"], {
      cwd: __dirname, stdio: ["ignore", "pipe", "pipe"],
    });
    analyzingProcesses.set(id, child);

    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));

    child.on("close", (code) => {
      analyzingProcesses.delete(id);
      const sources = readSources();
      const src = sources.sources.find((s) => s.id === id);
      if (!src) return;

      try {
        if (code !== 0) throw new Error(stderr || `claude exited with code ${code}`);
        // Parse claude JSON output, extract the result text
        const parsed = JSON.parse(stdout);
        let code_text = parsed.result || parsed;
        if (typeof code_text !== "string") code_text = JSON.stringify(code_text);
        // Strip markdown fences if present
        code_text = code_text.replace(/^```(?:javascript|js)?\n?/gm, "").replace(/```\s*$/gm, "").trim();
        writeFileSync(adapterPath, code_text + "\n");
        src.adapter = adapterFile;
        src.adapter_status = "ready";
        appendLog(id, "analyze", "ok", `Adapter generated: ${adapterFile}`);
      } catch (e) {
        src.adapter_status = "error";
        src.adapter_error = e.message;
        appendLog(id, "analyze", "error", e.message);
      }
      writeSources(sources);
    });

    return json(res, { ok: true, status: "generating" });
  }
  // ── Sources: get adapter code ──
  if (p.match(/^\/api\/sources\/[^/]+\/adapter$/) && req.method === "GET") {
    const id = decodeURIComponent(p.split("/")[3]);
    const sources = readSources();
    const src = sources.sources.find((s) => s.id === id);
    if (!src?.adapter) return json(res, { error: "no adapter" }, 404);
    const fp = join(ADAPTERS_DIR, src.adapter);
    if (!existsSync(fp)) return json(res, { error: "adapter file missing" }, 404);
    return json(res, { code: readFileSync(fp, "utf8") });
  }
  // ── Sources: save adapter code (manual edit) ──
  if (p.match(/^\/api\/sources\/[^/]+\/adapter$/) && req.method === "PUT") {
    const id = decodeURIComponent(p.split("/")[3]);
    const sources = readSources();
    const src = sources.sources.find((s) => s.id === id);
    if (!src) return json(res, { error: "source not found" }, 404);
    const { code } = JSON.parse(await readBody(req));
    const adapterFile = `${id}.mjs`;
    mkdirSync(ADAPTERS_DIR, { recursive: true });
    writeFileSync(join(ADAPTERS_DIR, adapterFile), code);
    src.adapter = adapterFile;
    src.adapter_status = "ready";
    writeSources(sources);
    return json(res, { ok: true });
  }
  // ── Sources: sync (run adapter) ──
  if (p.match(/^\/api\/sources\/[^/]+\/sync$/) && req.method === "POST") {
    const id = decodeURIComponent(p.split("/")[3]);
    const sources = readSources();
    const src = sources.sources.find((s) => s.id === id);
    if (!src) return json(res, { error: "source not found" }, 404);
    if (!src.adapter || src.adapter_status !== "ready") return json(res, { error: "adapter not ready" }, 400);

    appendLog(id, "sync", "start", `Running adapter ${src.adapter}`);
    try {
      const adapterPath = join(ADAPTERS_DIR, src.adapter);
      const mod = await import(`file://${adapterPath}?t=${Date.now()}`);
      const crawl = mod.default;

      const staging = readStaging();
      const existingIds = new Set(staging.map((s) => s.id));

      appendLog(id, "sync", "running", `Fetching items (${existingIds.size} existing)`);
      const items = await crawl({
        token: process.env.GITHUB_TOKEN || "",
        existingIds,
      });

      let added = 0;
      for (const item of items) {
        if (existingIds.has(item.id)) continue;
        staging.push({
          ...item,
          status: "pending",
          crawled_at: new Date().toISOString(),
          source_id: id,
        });
        existingIds.add(item.id);
        added++;
      }
      writeStaging(staging);

      src.last_sync = new Date().toISOString();
      src.last_sync_count = added;
      writeSources(sources);

      const msg = `Added ${added} new items (${items.length} total from source, ${items.length - added} skipped as duplicates)`;
      appendLog(id, "sync", "ok", msg);
      return json(res, { ok: true, added, total: items.length, message: msg });
    } catch (e) {
      appendLog(id, "sync", "error", e.message);
      return json(res, { error: e.message }, 500);
    }
  }

  // ── Staging CRUD ──
  if (p === "/api/staging" && req.method === "GET") return json(res, readStaging());
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
  if (p === "/api/staging/batch-delete" && req.method === "POST") {
    const { ids } = JSON.parse(await readBody(req));
    const idSet = new Set(ids);
    writeStaging(readStaging().filter((s) => !idSet.has(s.id)));
    return json(res, { ok: true, deleted: ids.length });
  }
  if (p === "/api/staging/batch-reject" && req.method === "POST") {
    const { ids } = JSON.parse(await readBody(req));
    const idSet = new Set(ids);
    const staging = readStaging();
    for (const s of staging) { if (idSet.has(s.id)) s.status = "rejected"; }
    writeStaging(staging);
    return json(res, { ok: true });
  }
  if (p.startsWith("/api/staging/") && !p.includes("/approve") && !p.includes("/reject") && req.method === "PUT") {
    const id = decodeURIComponent(p.slice("/api/staging/".length));
    const staging = readStaging();
    const idx = staging.findIndex((s) => s.id === id);
    if (idx === -1) return json(res, { error: "not found" }, 404);
    Object.assign(staging[idx], JSON.parse(await readBody(req)));
    writeStaging(staging);
    return json(res, { ok: true });
  }

  // ── Staging: approve → publish ──
  if (p.startsWith("/api/staging/") && p.endsWith("/approve") && req.method === "POST") {
    const id = decodeURIComponent(p.slice("/api/staging/".length, -"/approve".length));
    const staging = readStaging();
    const item = staging.find((s) => s.id === id);
    if (!item) return json(res, { error: "not found" }, 404);
    try {
      const type = item.type || "skill";
      const baseDir = type === "command" ? COMMANDS_DIR : SKILLS_DIR;
      const dir = join(baseDir, item.name);
      mkdirSync(dir, { recursive: true });

      const info = {
        name: item.name, type,
        display_name: item.display_name, description: item.description,
        author: { name: item.author, url: `https://github.com/${item.author}` },
        source: { repo: item.source_repo || "aiwatching/forge-skills", url: item.github_url || `https://github.com/${item.source_repo || "aiwatching/forge-skills"}` },
        version: item.version || "0.1.0", tags: item.tags || [], license: item.license || "",
      };
      writeFileSync(join(dir, "info.json"), JSON.stringify(info, null, 2) + "\n");

      if (item.files && item.files.length) {
        for (const f of item.files) {
          const fp = join(dir, f.relPath || f.name);
          mkdirSync(dirname(fp), { recursive: true });
          writeFileSync(fp, f.content || "");
        }
      } else if (item.content) {
        const entry = type === "command" ? `${item.name}.md` : "SKILL.md";
        writeFileSync(join(dir, entry), item.content);
      }

      execSync("node collector/score.mjs && node collector/build-registry.mjs", { cwd: __dirname, stdio: "pipe" });

      const typeDir = type === "command" ? "commands" : "skills";
      execSync(
        `git add "${typeDir}/${item.name}/" registry.json && ` +
        `git commit -m "publish: ${item.display_name || item.name}" && git push`,
        { cwd: __dirname, stdio: "pipe" });

      item.status = "approved";
      writeStaging(staging);
      return json(res, { ok: true, message: `Published "${item.display_name || item.name}"` });
    } catch (e) { return json(res, { error: e.stderr?.toString() || e.message }, 500); }
  }
  if (p.startsWith("/api/staging/") && p.endsWith("/reject") && req.method === "POST") {
    const id = decodeURIComponent(p.slice("/api/staging/".length, -"/reject".length));
    const staging = readStaging();
    const item = staging.find((s) => s.id === id);
    if (!item) return json(res, { error: "not found" }, 404);
    item.status = "rejected"; writeStaging(staging);
    return json(res, { ok: true });
  }
  if (p.startsWith("/api/staging/") && req.method === "DELETE") {
    const id = decodeURIComponent(p.slice("/api/staging/".length));
    writeStaging(readStaging().filter((s) => s.id !== id));
    return json(res, { ok: true });
  }

  // ── Published: list ──
  if (p === "/api/skills" && req.method === "GET") return json(res, listPublished(SKILLS_DIR));
  if (p === "/api/commands" && req.method === "GET") return json(res, listPublished(COMMANDS_DIR));

  // ── Published: delete ──
  if ((p.startsWith("/api/skills/") || p.startsWith("/api/commands/")) && req.method === "DELETE") {
    const isCmd = p.startsWith("/api/commands/");
    const name = decodeURIComponent(p.slice(isCmd ? "/api/commands/".length : "/api/skills/".length));
    const baseDir = isCmd ? COMMANDS_DIR : SKILLS_DIR;
    const dir = join(baseDir, name);
    if (!existsSync(dir)) return json(res, { error: "not found" }, 404);
    try {
      rmSync(dir, { recursive: true });
      execSync("node collector/score.mjs && node collector/build-registry.mjs", { cwd: __dirname, stdio: "pipe" });
      const typeDir = isCmd ? "commands" : "skills";
      execSync(`git add -A "${typeDir}/" registry.json && git commit -m "delete: ${name}" && git push`, { cwd: __dirname, stdio: "pipe" });
      return json(res, { ok: true });
    } catch (e) { return json(res, { error: e.stderr?.toString() || e.message }, 500); }
  }

  // ── Logs ──
  if (p === "/api/logs" && req.method === "GET") {
    const sourceId = url.searchParams.get("source");
    let logs = readLogs();
    if (sourceId) logs = logs.filter((l) => l.source_id === sourceId);
    const limit = parseInt(url.searchParams.get("limit") || "50");
    return json(res, logs.slice(0, limit));
  }

  // ── Rebuild ──
  if (p === "/api/rebuild" && req.method === "POST") {
    try {
      execSync("node collector/score.mjs && node collector/build-registry.mjs", { cwd: __dirname, stdio: "pipe" });
      return json(res, { ok: true });
    } catch (e) { return json(res, { error: e.stderr?.toString() || e.message }, 500); }
  }

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(HTML);
});

server.listen(PORT, () => console.log(`admin: http://localhost:${PORT}`));

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
.pane{display:none}.pane.active{display:block}
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
.tags{display:flex;gap:4px;margin-top:5px;flex-wrap:wrap}
.tag{background:#1f6feb22;color:#58a6ff;padding:2px 8px;border-radius:12px;font-size:11px}
.type-tag{padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600}
.type-skill{background:#23863633;color:#3fb950}
.type-command{background:#9e6a0333;color:#d29922}
.actions{display:flex;gap:5px;flex-shrink:0;align-items:center}
.meta{font-size:12px;color:#8b949e}
.score-badge{background:#1f6feb;color:#fff;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600}
.stars{color:#d29922;font-size:12px}
.status-badge{padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600}
.status-pending{background:#9e6a0333;color:#d29922}
.status-approved{background:#23863633;color:#3fb950}
.status-rejected{background:#da363333;color:#f85149}
.filter-bar{display:flex;gap:8px}
.filter-btn{padding:4px 12px;font-size:12px;border-radius:14px}
.filter-btn.active{background:#1f6feb;border-color:#1f6feb;color:#fff}
.overlay{position:fixed;inset:0;background:#000a;display:none;justify-content:center;align-items:flex-start;padding-top:50px;z-index:10}
.overlay.open{display:flex}
.modal{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:20px;width:640px;max-height:85vh;overflow-y:auto}
.modal h2{font-size:16px;margin-bottom:14px;color:#e6edf3}
.field{margin-bottom:10px}
.field label{display:block;font-size:12px;color:#8b949e;margin-bottom:4px}
.field input,.field textarea,.field select{width:100%;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:6px;padding:8px;font-size:13px;font-family:inherit}
.field textarea{min-height:140px;resize:vertical;font-family:"SF Mono","Fira Code",monospace;font-size:12px}
.field-row{display:flex;gap:10px}.field-row .field{flex:1}
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
.source-group{border:1px solid #21262d;border-radius:8px;margin-bottom:10px;overflow:hidden}
.source-group-header{padding:10px 14px;background:#161b22;cursor:pointer;font-size:14px;color:#58a6ff;user-select:none;border-bottom:1px solid #21262d}
.source-group-header:hover{background:#1c2128}
.source-group-header .tree-icon{display:inline-block;width:12px;font-size:10px;transition:transform .15s;color:#8b949e;margin-right:4px}
.source-group.open>.source-group-header .tree-icon{transform:rotate(90deg)}
.source-group-items{display:none;padding:4px}
.source-group.open>.source-group-items{display:block}
.type-subgroup{margin:4px 0}
.type-subgroup-label{padding:6px 14px;font-size:12px;font-weight:600;color:#8b949e;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #21262d}
.adapter-none{background:#30363d;color:#8b949e}
.adapter-generating{background:#9e6a0333;color:#d29922}
.adapter-ready{background:#23863633;color:#3fb950}
.adapter-error{background:#da363333;color:#f85149}
.tree-root{font-family:"SF Mono","Fira Code",monospace;font-size:13px}
.tree-dir{margin:1px 0}
.tree-label{padding:4px 8px;cursor:pointer;color:#e6edf3;border-radius:4px;user-select:none}
.tree-label:hover{background:#21262d}
.tree-icon{display:inline-block;width:12px;font-size:10px;transition:transform .15s;color:#8b949e}
.tree-dir.open>.tree-label .tree-icon{transform:rotate(90deg)}
.tree-children{display:none}
.tree-dir.open>.tree-children{display:block}
.tree-file{padding:4px 8px;cursor:pointer;color:#c9d1d9;border-radius:4px;user-select:none}
.tree-file:hover{background:#21262d}
.tree-file-icon{margin-right:4px;font-size:12px}
.tree-size{color:#484f58;font-size:11px;margin-left:8px}
.tree-content{display:none;margin:0 0 4px 20px}
.tree-content.open{display:block}
.tree-content pre{background:#0d1117;padding:10px;border-radius:6px;font-size:12px;max-height:400px;overflow:auto;white-space:pre-wrap;word-break:break-word;color:#c9d1d9;line-height:1.5;margin:0}
</style>
</head>
<body>
<h1>Forge Skills Admin</h1>
<div class="tabs" id="main-tabs">
  <div class="tab active" onclick="switchTab('sources')">Sources</div>
  <div class="tab" onclick="switchTab('staging')">Staging <span class="badge" id="staging-count">0</span></div>
  <div class="tab" onclick="switchTab('skills')">Skills <span class="badge" id="skills-count">0</span></div>
  <div class="tab" onclick="switchTab('commands')">Commands <span class="badge" id="commands-count">0</span></div>
</div>

<div class="pane active" id="pane-sources">
  <div class="bar">
    <input class="search-box" id="source-input" placeholder="URL or owner/repo" style="width:420px" onkeydown="if(event.key==='Enter')addSource()">
    <button class="primary" onclick="addSource()">+ Add Source</button>
  </div>
  <div id="sources-list"></div>
  <div id="source-output" style="margin-top:10px"></div>
</div>

<!-- Adapter Code Modal -->
<div class="overlay" id="adapter-overlay" onclick="if(event.target===this)E('adapter-overlay').classList.remove('open')">
  <div class="modal" style="width:800px">
    <h2 id="adapter-title">Adapter Code</h2>
    <div class="field"><textarea id="adapter-code" style="min-height:400px;font-size:12px"></textarea></div>
    <div class="modal-actions">
      <button onclick="E('adapter-overlay').classList.remove('open')">Cancel</button>
      <button class="primary" onclick="saveAdapter()">Save</button>
    </div>
  </div>
</div>

<div class="pane" id="pane-staging">
  <div class="bar">
    <div class="filter-bar">
      <button class="filter-btn active" onclick="setFilter('pending',this)">Pending</button>
      <button class="filter-btn" onclick="setFilter('approved',this)">Approved</button>
      <button class="filter-btn" onclick="setFilter('rejected',this)">Rejected</button>
      <button class="filter-btn" onclick="setFilter('all',this)">All</button>
    </div>
    <select class="search-box" id="source-filter" style="width:180px" onchange="stagingSourceFilter=this.value;renderStaging()">
      <option value="">All Sources</option>
    </select>
    <div class="bar-right">
      <input class="search-box" placeholder="Search..." oninput="stagingSearch=this.value;renderStaging()">
      <button class="primary" onclick="openAddModal()">+ Add</button>
    </div>
  </div>
  <div class="batch-bar" id="batch-bar">
    <input type="checkbox" onchange="toggleSelectAll(this.checked)" id="select-all">
    <span class="count" id="batch-count">0 selected</span>
    <button class="danger" onclick="batchDelete()">Delete</button>
    <button onclick="batchReject()">Reject</button>
  </div>
  <div id="staging-list"></div>
</div>

<div class="pane" id="pane-skills">
  <div class="bar"><span class="meta">Published Skills</span>
    <div class="bar-right">
      <input class="search-box" placeholder="Search..." oninput="pubSearch.skills=this.value;renderPub('skills')">
      <button onclick="rebuild()">Rebuild Registry</button>
    </div></div>
  <div id="skills-list"></div>
</div>

<div class="pane" id="pane-commands">
  <div class="bar"><span class="meta">Published Commands</span>
    <div class="bar-right">
      <input class="search-box" placeholder="Search..." oninput="pubSearch.commands=this.value;renderPub('commands')">
      <button onclick="rebuild()">Rebuild Registry</button>
    </div></div>
  <div id="commands-list"></div>
</div>

<!-- Add Modal -->
<div class="overlay" id="add-overlay" onclick="if(event.target===this)E('add-overlay').classList.remove('open')">
  <div class="modal">
    <h2>Add to Staging</h2>
    <div class="field-row">
      <div class="field"><label>Name (kebab-case)</label><input id="a-name"></div>
      <div class="field"><label>Type</label><select id="a-type"><option value="skill">Skill</option><option value="command">Command</option></select></div>
    </div>
    <div class="field"><label>Display Name</label><input id="a-display"></div>
    <div class="field"><label>Description</label><input id="a-desc"></div>
    <div class="field-row">
      <div class="field"><label>Author</label><input id="a-author" value="aiwatching"></div>
      <div class="field"><label>Version</label><input id="a-version" value="0.1.0"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Tags</label><input id="a-tags"></div>
      <div class="field"><label>License</label><input id="a-license" value="Apache-2.0"></div>
    </div>
    <div class="field"><label>Source Repo</label><input id="a-repo" value="aiwatching/forge-skills"></div>
    <div class="field"><label>Content</label><textarea id="a-content"></textarea></div>
    <div class="modal-actions">
      <button onclick="E('add-overlay').classList.remove('open')">Cancel</button>
      <button class="primary" onclick="submitAdd()">Add to Staging</button>
    </div>
  </div>
</div>

<!-- Staging Detail Modal -->
<div class="overlay" id="s-overlay" onclick="if(event.target===this)E('s-overlay').classList.remove('open')">
  <div class="modal">
    <h2 id="s-title">Detail</h2>
    <input type="hidden" id="s-id">
    <div class="field-row">
      <div class="field"><label>Name</label><input id="s-name"></div>
      <div class="field"><label>Type</label><select id="s-type"><option value="skill">Skill</option><option value="command">Command</option></select></div>
    </div>
    <div class="field"><label>Display Name</label><input id="s-display"></div>
    <div class="field"><label>Description</label><input id="s-desc"></div>
    <div class="field-row">
      <div class="field"><label>Author</label><input id="s-author"></div>
      <div class="field"><label>Version</label><input id="s-version"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Tags</label><input id="s-tags"></div>
      <div class="field"><label>License</label><input id="s-license"></div>
    </div>
    <div class="field"><label>Source Repo</label><input id="s-repo"></div>
    <div class="field"><label>Content</label><textarea id="s-content"></textarea></div>
    <div class="modal-actions">
      <button onclick="E('s-overlay').classList.remove('open')">Cancel</button>
      <button onclick="saveStagingEdit()">Save</button>
      <button class="danger" onclick="stagingAction('reject')">Reject</button>
      <button class="primary" onclick="stagingAction('approve')">Publish</button>
    </div>
  </div>
</div>

<script>
const E=id=>document.getElementById(id);
const esc=s=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
let stagingData=[],pubData={skills:[],commands:[]};
let stagingFilter="pending",stagingSearch="",stagingSourceFilter="",pubSearch={skills:"",commands:""};
const tabNames=["sources","staging","skills","commands"];

function switchTab(name){
  document.querySelectorAll("#main-tabs .tab").forEach((t,i)=>t.classList.toggle("active",tabNames[i]===name));
  document.querySelectorAll(".pane").forEach(p=>p.classList.remove("active"));
  E("pane-"+name).classList.add("active");
  if(name==="sources")loadSources();if(name==="staging")loadStaging();
  if(name==="skills")loadPub("skills");if(name==="commands")loadPub("commands");
}
function togglePreview(id){const el=E(id);if(el)el.classList.toggle("open")}
function matchSearch(item,q){if(!q)return true;q=q.toLowerCase();const i=item.info||item;return[i.name,i.display_name,i.description,i.source_repo,(i.tags||[]).join(" ")].some(v=>(v||"").toLowerCase().includes(q))}
function renderFilesPreview(item){
  // Build a tree from flat file list
  if(item.files&&item.files.length){
    const tree=buildTreeFromFiles(item.files);
    return'<div class="tree-root">'+tree.map(n=>renderTreeNode(n,0)).join("")+'</div>'}
  if(item.content)return'<div class="tree-root"><div class="tree-file" onclick="toggleFileContent(\\'sf-content\\')"><span class="tree-file-icon">📄</span> content</div><div class="tree-content" id="sf-content"><pre>'+esc(item.content)+'</pre></div></div>';
  return'<div class="preview-label">(no files)</div>'}

function buildTreeFromFiles(files){
  const root=[];
  for(const f of files){
    const parts=(f.relPath||f.name).split("/");
    let current=root;
    for(let i=0;i<parts.length-1;i++){
      let dir=current.find(n=>n.name===parts[i]&&n.type==="dir");
      if(!dir){dir={name:parts[i],type:"dir",children:[]};current.push(dir)}
      current=dir.children}
    current.push({name:parts[parts.length-1],type:"file",size:(f.content||"").length,content:f.content||"",github_url:f.github_url})}
  return root}

// Sources
let sourcesData={sources:[]};
let editingAdapterId=null;
async function loadSources(){sourcesData=await(await fetch("/api/sources")).json();renderSources()}
function renderSources(){
  const el=E("sources-list");
  const list=sourcesData.sources||[];
  if(!list.length){el.innerHTML='<div class="empty">No sources. Add a URL above.</div>';return}
  el.innerHTML=list.map(s=>{
    const ast=s.adapter_status||"none";
    const syncInfo=s.last_sync?'synced '+new Date(s.last_sync).toLocaleDateString()+' ('+s.last_sync_count+' items)':'never synced';
    return'<div class="card"><div class="card-head"><div><h3>'+esc(s.name)+'</h3></div><div class="actions">'
    +'<span class="status-badge adapter-'+ast+'">'+ast+'</span>'
    +'<a href="'+esc(s.url)+'" target="_blank" class="link-btn">Open</a>'
    +(ast==="none"||ast==="error"?'<button class="primary" onclick="analyzeSource(\\''+esc(s.id)+'\\',this)">Analyze</button>':'')
    +(ast==="ready"?'<button onclick="viewAdapter(\\''+esc(s.id)+'\\')">Adapter</button>':'')
    +(ast==="ready"?'<button class="primary" onclick="syncSource(\\''+esc(s.id)+'\\',this)">Sync</button>':'')
    +(ast==="generating"?'<button disabled>Analyzing...</button>':'')
    +'<button class="danger" onclick="removeSource(\\''+esc(s.id)+'\\')">Remove</button>'
    +'</div></div>'
    +'<button onclick="showLogs(\\''+esc(s.id)+'\\')">Logs</button>'
    +'</div></div>'
    +'<div class="card-body"><span class="meta">'+esc(s.url)+'</span><br><span class="meta">'+syncInfo+'</span>'
    +(s.adapter_error?'<br><span style="color:#f85149">Error: '+esc(s.adapter_error)+'</span>':'')
    +'</div>'
    +'<div class="preview" id="logs-'+esc(s.id)+'"></div>'
    +'</div>'}).join("")}

async function addSource(){
  const input=E("source-input");let url=input.value.trim();
  if(!url){alert("URL required");return}
  const r=await fetch("/api/sources",{method:"POST",body:JSON.stringify({url})});
  if(r.status===409){alert("Already added");return}
  if(!r.ok){const d=await r.json();alert(d.error);return}
  input.value="";loadSources()}

async function removeSource(id){if(!confirm("Remove source?"))return;await fetch("/api/sources/"+encodeURIComponent(id),{method:"DELETE"});loadSources()}

async function analyzeSource(id,btn){
  btn.textContent="Analyzing...";btn.disabled=true;
  const r=await fetch("/api/sources/"+encodeURIComponent(id)+"/analyze",{method:"POST"});
  const d=await r.json();
  if(!r.ok){alert("Error: "+(d.error||"unknown"));btn.textContent="Analyze";btn.disabled=false;return}
  // Poll until done
  const poll=setInterval(async()=>{
    const src=await(await fetch("/api/sources")).json();
    const s=(src.sources||[]).find(x=>x.id===id);
    if(s&&s.adapter_status!=="generating"){clearInterval(poll);loadSources();
      E("source-output").innerHTML='<div class="card"><div class="card-body" style="color:'+(s.adapter_status==="ready"?"#3fb950":"#f85149")+'">'+esc(s.adapter_status==="ready"?"Adapter generated! Click Sync to run.":"Analysis failed: "+(s.adapter_error||"unknown"))+'</div></div>'}
  },3000)}

async function syncSource(id,btn){
  btn.textContent="Syncing...";btn.disabled=true;
  const r=await fetch("/api/sources/"+encodeURIComponent(id)+"/sync",{method:"POST"});
  const d=await r.json();btn.textContent="Sync";btn.disabled=false;
  E("source-output").innerHTML='<div class="card"><div class="card-body" style="color:'+(r.ok?"#3fb950":"#f85149")+'">'+esc(r.ok?"Added "+d.added+" new items ("+d.total+" total from source)":("Error: "+(d.error||"unknown")))+'</div></div>';
  loadSources();loadCounts()}

async function viewAdapter(id){
  editingAdapterId=id;
  const r=await fetch("/api/sources/"+encodeURIComponent(id)+"/adapter");
  const d=await r.json();
  E("adapter-title").textContent="Adapter: "+id;
  E("adapter-code").value=d.code||"";
  E("adapter-overlay").classList.add("open")}

async function showLogs(id){
  const el=E("logs-"+id);
  if(el.classList.contains("open")){el.classList.remove("open");return}
  el.innerHTML='<div class="meta" style="padding:8px">Loading...</div>';
  el.classList.add("open");
  const logs=await(await fetch("/api/logs?source="+encodeURIComponent(id)+"&limit=20")).json();
  if(!logs.length){el.innerHTML='<div class="meta" style="padding:8px">No logs yet</div>';return}
  el.innerHTML='<div style="padding:4px 0">'+logs.map(l=>{
    const color=l.status==="ok"?"#3fb950":l.status==="error"?"#f85149":"#d29922";
    const time=new Date(l.time).toLocaleString();
    return'<div style="padding:3px 8px;font-size:12px;border-bottom:1px solid #21262d">'
      +'<span style="color:'+color+'">'+esc(l.status)+'</span> '
      +'<span class="meta">'+esc(l.action)+' · '+time+'</span><br>'
      +'<span style="color:#c9d1d9">'+esc(l.message)+'</span></div>'}).join("")+'</div>'}

async function saveAdapter(){
  if(!editingAdapterId)return;
  await fetch("/api/sources/"+encodeURIComponent(editingAdapterId)+"/adapter",{method:"PUT",body:JSON.stringify({code:E("adapter-code").value})});
  E("adapter-overlay").classList.remove("open");loadSources()}

// Staging
async function loadStaging(){
  stagingData=await(await fetch("/api/staging")).json();
  // Populate source filter dropdown
  const sel=E("source-filter");const prev=sel.value;
  const sourceIds=[...new Set(stagingData.map(s=>s.source_id||s.source_repo||"manual"))];
  sel.innerHTML='<option value="">All Sources ('+stagingData.length+')</option>'+sourceIds.map(id=>{
    const count=stagingData.filter(s=>(s.source_id||s.source_repo||"manual")===id).length;
    return'<option value="'+esc(id)+'">'+esc(id)+' ('+count+')</option>'}).join("");
  sel.value=prev||"";
  renderStaging();loadCounts()}
function setFilter(f,btn){stagingFilter=f;document.querySelectorAll(".filter-btn").forEach(b=>b.classList.remove("active"));btn.classList.add("active");renderStaging()}

function renderStagingCard(s,idx){
  const pid="sp-"+idx;const type=s.type||"skill";
  const repoUrl=s.repo_url||s.github_url||(s.source_repo?"https://github.com/"+s.source_repo:"");
  return'<div class="card"><div class="card-check"><input type="checkbox" value="'+esc(s.id)+'" onchange="updateBatchBar()"><div style="flex:1;min-width:0"><div class="card-head"><div><h3>'+esc(s.display_name||s.name)+'</h3></div><div class="actions">'
  +'<span class="type-tag type-'+type+'">'+type+'</span>'
  +(s.repo_stars?'<span class="stars">★ '+s.repo_stars+'</span>':'')
  +(s.file_count?'<span class="meta">'+s.file_count+' files</span>':'')
  +(repoUrl?'<a href="'+esc(repoUrl)+'" target="_blank" class="link-btn">GitHub</a>':'')
  +'<span class="status-badge status-'+s.status+'">'+s.status+'</span>'
  +'<button class="btn-preview" onclick="togglePreview(\\''+pid+'\\')">Preview</button>'
  +'<button onclick="openStagingDetail(\\''+esc(s.id)+'\\')">Edit</button>'
  +(s.status==="pending"?'<button class="primary" onclick="quickApprove(\\''+esc(s.id)+'\\')">Publish</button>':'')
  +(s.status==="pending"?'<button class="danger" onclick="quickReject(\\''+esc(s.id)+'\\')">Reject</button>':'')
  +'<button style="font-size:11px;padding:4px 8px" onclick="delStaging(\\''+esc(s.id)+'\\')">×</button>'
  +'</div></div><div class="card-body">'+(s.description?esc(s.description):'')+'</div>'
  +(s.tags?.length?'<div class="tags">'+s.tags.map(t=>'<span class="tag">'+esc(t)+'</span>').join("")+'</div>':'')
  +'<div class="preview" id="'+pid+'">'+renderFilesPreview(s)+'</div></div></div></div>'}

function renderStaging(){
  let list=stagingFilter==="all"?stagingData:stagingData.filter(s=>s.status===stagingFilter);
  if(stagingSourceFilter)list=list.filter(s=>(s.source_id||s.source_repo||"manual")===stagingSourceFilter);
  list=list.filter(s=>matchSearch(s,stagingSearch));
  const el=E("staging-list");
  if(!list.length){el.innerHTML='<div class="empty">'+(stagingSearch?"No matches":"No "+stagingFilter+" items")+'</div>';return}

  // Group by source
  const groups={};
  list.forEach((s,idx)=>{
    const src=s.source_id||s.source_repo||"manual";
    if(!groups[src])groups[src]=[];
    groups[src].push({s,idx})});

  const keys=Object.keys(groups);

  function renderTypeSubgroup(items, label) {
    if(!items.length) return "";
    return '<div class="type-subgroup"><div class="type-subgroup-label">'+esc(label)+' <span class="meta">('+items.length+')</span></div>'
      +items.map(({s,idx})=>renderStagingCard(s,idx)).join("")+'</div>';
  }
  function renderGroupContent(items) {
    const skills=items.filter(({s})=>(s.type||"skill")==="skill");
    const commands=items.filter(({s})=>(s.type||"skill")==="command");
    // If all same type, no subgroup headers
    if(!skills.length||!commands.length) return items.map(({s,idx})=>renderStagingCard(s,idx)).join("");
    return renderTypeSubgroup(skills,"Skills")+renderTypeSubgroup(commands,"Commands");
  }

  if(keys.length===1||stagingSourceFilter){
    const items=list.map((s,idx)=>({s,idx}));
    el.innerHTML=renderGroupContent(items);
  } else {
    el.innerHTML=keys.map(src=>{
      const items=groups[src];
      return'<div class="source-group">'
        +'<div class="source-group-header" onclick="this.parentElement.classList.toggle(\\'open\\')">'
        +'<span class="tree-icon">▶</span> '+esc(src)+' <span class="meta">('+items.length+')</span></div>'
        +'<div class="source-group-items">'+renderGroupContent(items)+'</div>'
        +'</div>'}).join("")}
  updateBatchBar()}
function getSelectedIds(){return[...document.querySelectorAll('#staging-list input[type=checkbox]:checked')].map(c=>c.value)}
function updateBatchBar(){const ids=getSelectedIds();E("batch-bar").classList.toggle("show",ids.length>0);E("batch-count").textContent=ids.length+" selected"}
function toggleSelectAll(c){document.querySelectorAll('#staging-list input[type=checkbox]').forEach(cb=>cb.checked=c);updateBatchBar()}
async function batchDelete(){const ids=getSelectedIds();if(!ids.length||!confirm("Delete "+ids.length+"?"))return;await fetch("/api/staging/batch-delete",{method:"POST",body:JSON.stringify({ids})});E("select-all").checked=false;loadStaging()}
async function batchReject(){const ids=getSelectedIds();if(!ids.length||!confirm("Reject "+ids.length+"?"))return;await fetch("/api/staging/batch-reject",{method:"POST",body:JSON.stringify({ids})});E("select-all").checked=false;loadStaging()}

function openAddModal(){E("a-name").value="";E("a-type").value="skill";E("a-display").value="";E("a-desc").value="";E("a-author").value="aiwatching";E("a-version").value="0.1.0";E("a-tags").value="";E("a-license").value="Apache-2.0";E("a-repo").value="aiwatching/forge-skills";E("a-content").value="";E("add-overlay").classList.add("open")}
async function submitAdd(){const name=E("a-name").value.trim();if(!name){alert("Name required");return}
  await fetch("/api/staging",{method:"POST",body:JSON.stringify({name,type:E("a-type").value,display_name:E("a-display").value.trim(),description:E("a-desc").value.trim(),author:E("a-author").value.trim(),version:E("a-version").value.trim(),source_repo:E("a-repo").value.trim(),tags:E("a-tags").value.split(",").map(t=>t.trim()).filter(Boolean),license:E("a-license").value.trim(),content:E("a-content").value})});
  E("add-overlay").classList.remove("open");loadStaging()}

function openStagingDetail(id){const s=stagingData.find(x=>x.id===id);if(!s)return;
  E("s-title").textContent=s.display_name||s.name;E("s-id").value=s.id;E("s-name").value=s.name||"";E("s-type").value=s.type||"skill";
  E("s-display").value=s.display_name||"";E("s-desc").value=s.description||"";E("s-author").value=s.author||"";E("s-version").value=s.version||"0.1.0";
  E("s-tags").value=(s.tags||[]).join(", ");E("s-license").value=s.license||"";E("s-repo").value=s.source_repo||"";
  E("s-content").value=s.content||(s.files?s.files.map(f=>"// "+f.relPath+"\\n"+f.content).join("\\n\\n"):"");
  E("s-overlay").classList.add("open")}
async function saveStagingEdit(){await fetch("/api/staging/"+encodeURIComponent(E("s-id").value),{method:"PUT",body:JSON.stringify({name:E("s-name").value.trim(),type:E("s-type").value,display_name:E("s-display").value.trim(),description:E("s-desc").value.trim(),author:E("s-author").value.trim(),version:E("s-version").value.trim(),tags:E("s-tags").value.split(",").map(t=>t.trim()).filter(Boolean),license:E("s-license").value.trim(),source_repo:E("s-repo").value.trim(),content:E("s-content").value})});E("s-overlay").classList.remove("open");loadStaging()}
async function stagingAction(action){const id=E("s-id").value;const r=await fetch("/api/staging/"+encodeURIComponent(id)+"/"+action,{method:"POST"});const d=await r.json();E("s-overlay").classList.remove("open");if(!r.ok)alert("Error: "+(d.error||"unknown"));else if(d.message)alert(d.message);loadStaging();loadCounts()}
async function quickApprove(id){if(!confirm("Publish? (git push)"))return;const btn=event.target;btn.textContent="...";btn.disabled=true;const r=await fetch("/api/staging/"+encodeURIComponent(id)+"/approve",{method:"POST"});const d=await r.json();btn.textContent="Publish";btn.disabled=false;if(!r.ok)alert("Error: "+(d.error||"unknown"));else if(d.message)alert(d.message);loadStaging();loadCounts()}
async function quickReject(id){await fetch("/api/staging/"+encodeURIComponent(id)+"/reject",{method:"POST"});loadStaging();loadCounts()}
async function delStaging(id){if(!confirm("Remove?"))return;await fetch("/api/staging/"+encodeURIComponent(id),{method:"DELETE"});loadStaging()}

// Published
async function loadPub(type){pubData[type]=await(await fetch("/api/"+type)).json();renderPub(type);loadCounts()}
function renderTreeNode(node, depth) {
  if (node.type === "dir") {
    const id = "tn-" + Math.random().toString(36).slice(2, 8);
    return '<div class="tree-dir">'
      + '<div class="tree-label" onclick="this.parentElement.classList.toggle(\\'open\\')" style="padding-left:' + (depth * 16) + 'px">'
      + '<span class="tree-icon">▶</span> ' + esc(node.name) + '/'
      + '</div>'
      + '<div class="tree-children">' + node.children.map(c => renderTreeNode(c, depth + 1)).join("") + '</div>'
      + '</div>';
  }
  const fid = "tf-" + Math.random().toString(36).slice(2, 8);
  return '<div class="tree-file" style="padding-left:' + (depth * 16 + 20) + 'px" onclick="toggleFileContent(\\'' + fid + '\\')">'
    + '<span class="tree-file-icon">📄</span> ' + esc(node.name)
    + '<span class="tree-size">' + formatSize(node.size || 0) + '</span>'
    + '</div>'
    + '<div class="tree-content" id="' + fid + '"><pre>' + esc(node.content || "") + '</pre></div>';
}
function formatSize(b) { if (b < 1024) return b + "B"; if (b < 1048576) return (b / 1024).toFixed(1) + "K"; return (b / 1048576).toFixed(1) + "M"; }
function toggleFileContent(id) { const el = E(id); if (el) el.classList.toggle("open"); }

function countFiles(tree) { let n = 0; for (const t of tree) { if (t.type === "file") n++; else if (t.children) n += countFiles(t.children); } return n; }

function renderPub(type){
  let list=pubData[type]||[];if(pubSearch[type])list=list.filter(s=>matchSearch(s,pubSearch[type]));
  const el=E(type+"-list");
  if(!list.length){el.innerHTML='<div class="empty">'+(pubSearch[type]?"No matches":"No published "+type)+'</div>';return}
  el.innerHTML=list.map((s,idx)=>{const i=s.info;const pid=type[0]+"p-"+idx;const srcUrl=i.source?.url||"";
    const fc=countFiles(s.tree||[]);
    return'<div class="card"><div class="card-head"><div><h3>'+esc(i.display_name||i.name)+'</h3></div><div class="actions">'
    +(i.score!=null?'<span class="score-badge">'+i.score+'</span>':'')
    +'<span class="meta">v'+esc(i.version||"")+'</span>'
    +'<span class="meta">'+fc+' files</span>'
    +(srcUrl?'<a href="'+esc(srcUrl)+'" target="_blank" class="link-btn">GitHub</a>':'')
    +'<button class="btn-preview" onclick="togglePreview(\\''+pid+'\\')">Files</button>'
    +'<button class="danger" onclick="delPub(\\''+type+'\\',\\''+esc(s.dir)+'\\')">Delete</button>'
    +'</div></div><div class="card-body">'+esc(i.description||"")+'</div>'
    +(i.tags?.length?'<div class="tags">'+i.tags.map(t=>'<span class="tag">'+esc(t)+'</span>').join("")+'</div>':'')
    +'<div class="preview" id="'+pid+'">'
    +'<div class="tree-root">'+(s.tree||[]).map(n=>renderTreeNode(n,0)).join("")+'</div>'
    +'</div></div>'}).join("")}
async function delPub(type,name){if(!confirm("Delete "+name+"? (git push)"))return;const r=await fetch("/api/"+type+"/"+encodeURIComponent(name),{method:"DELETE"});if(!r.ok){const d=await r.json();alert("Error: "+(d.error||"unknown"))}loadPub(type)}
async function rebuild(){const r=await fetch("/api/rebuild",{method:"POST"});if(r.ok){alert("Registry rebuilt");loadPub("skills");loadPub("commands")}else{const d=await r.json();alert("Error: "+d.error)}}
async function loadCounts(){try{const[st,sk,cm]=await Promise.all([fetch("/api/staging").then(r=>r.json()),fetch("/api/skills").then(r=>r.json()),fetch("/api/commands").then(r=>r.json())]);E("staging-count").textContent=st.filter(s=>s.status==="pending").length;E("skills-count").textContent=sk.length;E("commands-count").textContent=cm.length}catch{}}

loadSources();loadCounts();
</script>
</body>
</html>`;

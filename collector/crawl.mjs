#!/usr/bin/env node
// GitHub crawler — downloads all command/skill files from repos
// Groups all files per repo into one staging entry
// Usage: node crawl.mjs              (all repos from sources.json)
//        node crawl.mjs --repo owner/repo  (single repo)

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SKILLS_DIR = join(ROOT, "skills");
const SOURCES_PATH = join(ROOT, "sources.json");
const STAGING_PATH = join(ROOT, "staging.json");

const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) {
  console.error("crawl: GITHUB_TOKEN is required");
  process.exit(1);
}

const headers = {
  Accept: "application/vnd.github.v3+json",
  Authorization: `Bearer ${TOKEN}`,
  "User-Agent": "forge-skills-crawler",
};

async function ghFetch(url) {
  const res = await fetch(url, { headers });
  if (res.status === 403 || res.status === 429) {
    const reset = res.headers.get("x-ratelimit-reset");
    const waitSec = reset ? Math.max(0, Number(reset) - Date.now() / 1000) : 60;
    console.warn(`crawl: rate limited, waiting ${Math.ceil(waitSec)}s...`);
    await new Promise((r) => setTimeout(r, (waitSec + 1) * 1000));
    return ghFetch(url);
  }
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function fetchRawContent(owner, repo, path) {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${path}`;
  const res = await fetch(url, { headers: { "User-Agent": "forge-skills-crawler" } });
  if (!res.ok) return null;
  return res.text();
}

async function fetchRepoMeta(owner, repo) {
  try {
    return await ghFetch(`https://api.github.com/repos/${owner}/${repo}`);
  } catch {
    return null;
  }
}

// Known directories where skill/command files live (priority order)
const SKILL_PATHS = [".claude/skills", ".claude/commands", "skills", "commands"];
const SKIP_FILES = new Set(["README.md", "CHANGELOG.md", "LICENSE.md", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md"]);

// Recursively list all files under a directory
async function listAllFiles(owner, repo, dir) {
  const results = [];
  try {
    const items = await ghFetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${dir}`
    );
    if (!Array.isArray(items)) return results;
    for (const f of items) {
      if (f.type === "file" && !SKIP_FILES.has(f.name)) {
        // Relative path within the skill directory
        const relPath = f.path.startsWith(dir + "/") ? f.path.slice(dir.length + 1) : f.name;
        results.push({ path: f.path, relPath, name: f.name });
      } else if (f.type === "dir") {
        const sub = await listAllFiles(owner, repo, f.path);
        results.push(...sub);
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  } catch {
    // directory doesn't exist
  }
  return results;
}

// Find the skill directory in a repo and list all files
async function crawlRepo(ownerRepo) {
  const [owner, repo] = ownerRepo.split("/");

  // Try known paths
  for (const dir of SKILL_PATHS) {
    const files = await listAllFiles(owner, repo, dir);
    if (files.length > 0) {
      return { dir, files };
    }
  }

  // Fallback: root-level .md files (not recursive)
  try {
    const items = await ghFetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/`
    );
    if (Array.isArray(items)) {
      const files = items
        .filter((f) => f.type === "file" && f.name.endsWith(".md") && !SKIP_FILES.has(f.name))
        .map((f) => ({ path: f.path, relPath: f.name, name: f.name }));
      if (files.length > 0) return { dir: "", files };
    }
  } catch (e) {
    console.warn(`crawl: skip ${ownerRepo} — ${e.message}`);
  }

  return { dir: "", files: [] };
}

async function main() {
  const singleRepo = process.argv.find((_, i, a) => a[i - 1] === "--repo");

  let reposToCrawl;
  if (singleRepo) {
    reposToCrawl = [singleRepo];
  } else {
    if (!existsSync(SOURCES_PATH)) {
      console.log("crawl: no sources.json found — add repos in admin UI first");
      return;
    }
    const sources = JSON.parse(readFileSync(SOURCES_PATH, "utf8"));
    reposToCrawl = sources.repos || [];
  }

  if (!reposToCrawl.length) {
    console.log("crawl: no repos to crawl");
    return;
  }

  // Load existing staging
  const existingStaging = existsSync(STAGING_PATH)
    ? JSON.parse(readFileSync(STAGING_PATH, "utf8"))
    : [];
  const existingIds = new Set(existingStaging.map((s) => s.id));

  // Also check published skills
  if (existsSync(SKILLS_DIR)) {
    for (const d of readdirSync(SKILLS_DIR)) {
      if (!statSync(join(SKILLS_DIR, d)).isDirectory()) continue;
      existingIds.add(d); // skill dir name as id
    }
  }

  let added = 0;

  for (const ownerRepo of reposToCrawl) {
    const id = ownerRepo; // one staging entry per repo
    if (existingIds.has(id)) {
      console.log(`crawl: skip ${ownerRepo} — already in staging or published`);
      continue;
    }

    console.log(`crawl: crawling ${ownerRepo}`);
    const { dir: skillDir, files: fileList } = await crawlRepo(ownerRepo);

    if (!fileList.length) {
      console.log(`crawl: no files found in ${ownerRepo}`);
      continue;
    }

    console.log(`crawl: found ${fileList.length} files in ${ownerRepo}/${skillDir}`);

    // Fetch repo metadata
    const [owner, repo] = ownerRepo.split("/");
    const repoMeta = await fetchRepoMeta(owner, repo);

    // Download all file contents
    const files = [];
    for (const f of fileList) {
      const content = await fetchRawContent(owner, repo, f.path);
      if (content !== null) {
        files.push({
          name: f.name,
          relPath: f.relPath,
          sourcePath: f.path,
          github_url: `https://github.com/${ownerRepo}/blob/main/${f.path}`,
          content,
        });
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    if (!files.length) {
      console.warn(`crawl: skip ${ownerRepo} — all downloads failed`);
      continue;
    }

    // Derive a clean name from repo
    const displayName = repo.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

    existingStaging.push({
      id,
      name: repo,
      display_name: displayName,
      description: repoMeta?.description || "",
      author: owner,
      source_repo: ownerRepo,
      source_dir: skillDir,
      github_url: `https://github.com/${ownerRepo}`,
      repo_url: `https://github.com/${ownerRepo}`,
      repo_stars: repoMeta?.stargazers_count || 0,
      license: repoMeta?.license?.spdx_id || "",
      files,
      file_count: files.length,
      crawled_at: new Date().toISOString(),
      status: "pending",
    });
    added++;
  }

  writeFileSync(STAGING_PATH, JSON.stringify(existingStaging, null, 2) + "\n");
  console.log(`crawl: added ${added} new, total ${existingStaging.length} in staging`);
}

main().catch((e) => {
  console.error("crawl: fatal error:", e.message);
  process.exit(1);
});

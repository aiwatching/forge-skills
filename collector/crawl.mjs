#!/usr/bin/env node
// GitHub crawler — searches for .claude/commands/*.md files
// Writes results to staging.json for review, NOT directly into skills/

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

async function searchSkillFiles(query, minStars) {
  const results = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const q = encodeURIComponent(query);
    const data = await ghFetch(
      `https://api.github.com/search/code?q=${q}&per_page=${perPage}&page=${page}`
    );
    for (const item of data.items || []) {
      if (!item.path.startsWith(".claude/commands/") || !item.path.endsWith(".md")) continue;
      results.push({
        owner: item.repository.owner.login,
        repo: item.repository.name,
        path: item.path,
        filename: basename(item.path, ".md"),
      });
    }
    if (!data.items || data.items.length < perPage || page >= 10) break;
    page++;
    await new Promise((r) => setTimeout(r, 2000));
  }

  if (minStars > 0) {
    const cache = {};
    const filtered = [];
    for (const item of results) {
      const key = `${item.owner}/${item.repo}`;
      if (!(key in cache)) cache[key] = await fetchRepoMeta(item.owner, item.repo);
      if (cache[key]?.stargazers_count >= minStars) {
        filtered.push({ ...item, stars: cache[key].stargazers_count });
      }
    }
    return filtered;
  }
  return results;
}

// Try multiple known paths where skill .md files might live
const SKILL_PATHS = [
  ".claude/commands",
  "commands",
  "skills",
];

const SKIP_FILES = new Set(["README.md", "CHANGELOG.md", "LICENSE.md", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md"]);

// Recursively list all .md files under a directory
async function listMdFiles(owner, repo, dir) {
  const results = [];
  try {
    const items = await ghFetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${dir}`
    );
    if (!Array.isArray(items)) return results;
    for (const f of items) {
      if (f.type === "file" && f.name.endsWith(".md") && !SKIP_FILES.has(f.name)) {
        results.push({ owner, repo, path: f.path, filename: basename(f.name, ".md") });
      } else if (f.type === "dir") {
        // Recurse into subdirectories
        const sub = await listMdFiles(owner, repo, f.path);
        results.push(...sub);
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  } catch {
    // directory doesn't exist
  }
  return results;
}

async function crawlRepo(ownerRepo) {
  const [owner, repo] = ownerRepo.split("/");
  let results = [];

  for (const dir of SKILL_PATHS) {
    results = await listMdFiles(owner, repo, dir);
    if (results.length > 0) break;
  }

  // Fallback: scan root (non-recursive, only top-level .md)
  if (results.length === 0) {
    try {
      const items = await ghFetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/`
      );
      if (Array.isArray(items)) {
        for (const f of items) {
          if (f.type === "file" && f.name.endsWith(".md") && !SKIP_FILES.has(f.name)) {
            results.push({ owner, repo, path: f.path, filename: basename(f.name, ".md") });
          }
        }
      }
    } catch (e) {
      console.warn(`crawl: skip ${ownerRepo} — ${e.message}`);
    }
  }

  return results;
}

function dedup(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.owner}/${item.repo}/${item.filename}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Support: node crawl.mjs              (all repos from sources.json)
//         node crawl.mjs --repo owner/repo  (single repo)
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

  // Load existing staging to preserve status
  const existingStaging = existsSync(STAGING_PATH)
    ? JSON.parse(readFileSync(STAGING_PATH, "utf8"))
    : [];
  const existingKeys = new Set(existingStaging.map((s) => s.id));

  // Also collect published skill names for dedup
  if (existsSync(SKILLS_DIR)) {
    for (const d of readdirSync(SKILLS_DIR)) {
      if (!statSync(join(SKILLS_DIR, d)).isDirectory()) continue;
      const infoPath = join(SKILLS_DIR, d, "info.json");
      if (!existsSync(infoPath)) continue;
      try {
        const info = JSON.parse(readFileSync(infoPath, "utf8"));
        if (info.source?.repo && info.name) {
          existingKeys.add(`${info.source.repo}/${info.name}`);
        }
      } catch {}
    }
  }
  console.log(`crawl: ${existingKeys.size} existing items (staging + published)`);

  let allItems = [];

  for (const ownerRepo of reposToCrawl) {
    console.log(`crawl: crawling ${ownerRepo}`);
    const items = await crawlRepo(ownerRepo);
    console.log(`crawl: found ${items.length} files in ${ownerRepo}`);
    allItems.push(...items);
  }

  allItems = dedup(allItems);
  console.log(`crawl: ${allItems.length} unique skills after dedup`);

  const repoCache = {};
  let added = 0;

  for (const item of allItems) {
    const id = `${item.owner}/${item.repo}/${item.filename}`;
    if (existingKeys.has(id)) continue; // already in staging

    const repoKey = `${item.owner}/${item.repo}`;
    if (!(repoKey in repoCache)) {
      repoCache[repoKey] = await fetchRepoMeta(item.owner, item.repo);
    }
    const repoMeta = repoCache[repoKey];

    const content = await fetchRawContent(item.owner, item.repo, item.path);
    if (!content) {
      console.warn(`crawl: skip ${id} — fetch failed`);
      continue;
    }

    existingStaging.push({
      id,
      name: item.filename,
      display_name: item.filename.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      description: "",
      author: item.owner,
      source_repo: repoKey,
      source_path: item.path,
      github_url: `https://github.com/${repoKey}/blob/main/${item.path}`,
      repo_url: `https://github.com/${repoKey}`,
      repo_stars: repoMeta?.stargazers_count || 0,
      repo_description: repoMeta?.description || "",
      license: repoMeta?.license?.spdx_id || "",
      content,
      crawled_at: new Date().toISOString(),
      status: "pending",
    });
    added++;
    await new Promise((r) => setTimeout(r, 200));
  }

  writeFileSync(STAGING_PATH, JSON.stringify(existingStaging, null, 2) + "\n");
  console.log(`crawl: added ${added} new, total ${existingStaging.length} in staging`);
}

main().catch((e) => {
  console.error("crawl: fatal error:", e.message);
  process.exit(1);
});

#!/usr/bin/env node
// GitHub crawler — searches for .claude/commands/*.md files
// Downloads skill files and creates skills/<name>/ directories with info.json + skill.md

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";
import { parse as parseYaml } from "./yaml-lite.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SKILLS_DIR = join(ROOT, "skills");
const SOURCES_PATH = join(ROOT, "sources.yaml");

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

// Search GitHub for .claude/commands/*.md files
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

// List .claude/commands/*.md from an explicit repo
async function crawlRepo(ownerRepo) {
  const [owner, repo] = ownerRepo.split("/");
  try {
    const items = await ghFetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/.claude/commands`
    );
    return items
      .filter((f) => f.type === "file" && f.name.endsWith(".md"))
      .map((f) => ({ owner, repo, path: f.path, filename: basename(f.name, ".md") }));
  } catch (e) {
    console.warn(`crawl: skip ${ownerRepo} — ${e.message}`);
    return [];
  }
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

// Derive a unique skill directory name
function skillDirName(item) {
  return `${item.owner}--${item.repo}--${item.filename}`;
}

async function main() {
  const sources = parseYaml(readFileSync(SOURCES_PATH, "utf8"));
  mkdirSync(SKILLS_DIR, { recursive: true });

  let allItems = [];

  for (const search of sources.github_search || []) {
    console.log(`crawl: searching "${search.query}" (min_stars: ${search.min_stars || 0})`);
    const items = await searchSkillFiles(search.query, search.min_stars || 0);
    console.log(`crawl: found ${items.length} files`);
    allItems.push(...items);
  }

  for (const ownerRepo of sources.repos || []) {
    console.log(`crawl: crawling ${ownerRepo}`);
    const items = await crawlRepo(ownerRepo);
    console.log(`crawl: found ${items.length} files in ${ownerRepo}`);
    allItems.push(...items);
  }

  allItems = dedup(allItems);
  console.log(`crawl: ${allItems.length} unique skills after dedup`);

  const repoCache = {};
  let written = 0;

  for (const item of allItems) {
    const repoKey = `${item.owner}/${item.repo}`;
    if (!(repoKey in repoCache)) {
      repoCache[repoKey] = await fetchRepoMeta(item.owner, item.repo);
    }
    const repoMeta = repoCache[repoKey];

    const content = await fetchRawContent(item.owner, item.repo, item.path);
    if (!content) {
      console.warn(`crawl: skip ${repoKey}/${item.path} — fetch failed`);
      continue;
    }

    const dir = join(SKILLS_DIR, skillDirName(item));
    mkdirSync(dir, { recursive: true });

    // Write skill.md
    writeFileSync(join(dir, "skill.md"), content);

    // Write info.json
    const info = {
      name: item.filename,
      display_name: item.filename.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      description: "",
      author: {
        name: item.owner,
        url: `https://github.com/${item.owner}`,
      },
      source: {
        repo: repoKey,
        path: item.path,
        url: `https://github.com/${repoKey}/blob/main/${item.path}`,
      },
      version: "0.0.0",
      tags: [],
      license: repoMeta?.license?.spdx_id || "",
      repo_stars: repoMeta?.stargazers_count || 0,
      repo_description: repoMeta?.description || "",
      crawled_at: new Date().toISOString(),
    };

    writeFileSync(join(dir, "info.json"), JSON.stringify(info, null, 2) + "\n");
    written++;
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`crawl: wrote ${written} skills`);
}

main().catch((e) => {
  console.error("crawl: fatal error:", e.message);
  process.exit(1);
});

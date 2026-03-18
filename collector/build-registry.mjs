#!/usr/bin/env node
// Build registry.json by reading all skills/*/info.json

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SKILLS_DIR = join(ROOT, "skills");
const REGISTRY_PATH = join(ROOT, "registry.json");

const dirs = readdirSync(SKILLS_DIR).filter((d) =>
  statSync(join(SKILLS_DIR, d)).isDirectory()
);

const skills = [];

for (const dir of dirs) {
  const infoPath = join(SKILLS_DIR, dir, "info.json");
  if (!existsSync(infoPath)) continue;

  const info = JSON.parse(readFileSync(infoPath, "utf8"));
  skills.push({
    name: info.name,
    display_name: info.display_name,
    description: info.description,
    author: info.author,
    source: info.source,
    version: info.version,
    tags: info.tags || [],
    license: info.license || "",
    score: info.score || 0,
    dir,
  });
}

skills.sort((a, b) => b.score - a.score);

const registry = {
  version: 1,
  updated_at: new Date().toISOString(),
  total: skills.length,
  skills,
};

writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + "\n");
console.log(`registry: wrote ${skills.length} skills to registry.json`);

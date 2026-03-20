#!/usr/bin/env node
// Build registry.json v2 — reads skills/*/info.json and commands/*/info.json

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SKILLS_DIR = join(ROOT, "skills");
const COMMANDS_DIR = join(ROOT, "commands");
const REGISTRY_PATH = join(ROOT, "registry.json");

function collectItems(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((d) => {
      const p = join(dir, d);
      return statSync(p).isDirectory() && existsSync(join(p, "info.json"));
    })
    .map((d) => {
      const info = JSON.parse(readFileSync(join(dir, d, "info.json"), "utf8"));
      return {
        name: info.name,
        type: info.type,
        display_name: info.display_name,
        description: info.description,
        author: info.author,
        source: info.source,
        version: info.version,
        tags: info.tags || [],
        license: info.license || "",
        score: info.score || 0,
      };
    })
    .sort((a, b) => b.score - a.score);
}

const skills = collectItems(SKILLS_DIR);
const commands = collectItems(COMMANDS_DIR);

const registry = {
  version: 2,
  updated_at: new Date().toISOString(),
  total: skills.length + commands.length,
  skills,
  commands,
};

writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + "\n");
console.log(`registry: ${skills.length} skills, ${commands.length} commands → registry.json`);

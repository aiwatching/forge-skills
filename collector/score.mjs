#!/usr/bin/env node
// Scoring — reads skills/*/info.json, computes score, writes back into info.json

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(__dirname, "..", "skills");

const dirs = readdirSync(SKILLS_DIR).filter((d) =>
  statSync(join(SKILLS_DIR, d)).isDirectory()
);

if (dirs.length === 0) {
  console.log("score: no skills found");
  process.exit(0);
}

let scored = 0;

for (const dir of dirs) {
  const infoPath = join(SKILLS_DIR, dir, "info.json");
  const skillPath = join(SKILLS_DIR, dir, "skill.md");
  if (!existsSync(infoPath)) continue;

  const info = JSON.parse(readFileSync(infoPath, "utf8"));
  let score = 0;

  // Stars (log scale, max ~40 points)
  const stars = info.repo_stars || 0;
  if (stars > 0) score += Math.min(40, Math.log10(stars) * 20);

  // Content quality
  if (existsSync(skillPath)) {
    const content = readFileSync(skillPath, "utf8");
    const len = content.length;
    if (len >= 200) score += 20;
    else if (len >= 50) score += 10;
    if (content.includes("#")) score += 5;
    if (content.includes("- ") || content.includes("* ")) score += 5;
    if (content.includes("```")) score += 5;
    if (len < 30) score -= 20;
  }

  if (info.description) score += 5;
  if (info.tags?.length > 0) score += 5;

  info.score = Math.max(0, Math.round(score));
  writeFileSync(infoPath, JSON.stringify(info, null, 2) + "\n");
  scored++;
}

console.log(`score: scored ${scored} skills`);

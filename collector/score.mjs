#!/usr/bin/env node
// Scoring — reads skills/*/info.json and commands/*/info.json, computes score

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function scoreDir(baseDir) {
  if (!existsSync(baseDir)) return 0;
  const dirs = readdirSync(baseDir).filter((d) =>
    statSync(join(baseDir, d)).isDirectory() && existsSync(join(baseDir, d, "info.json"))
  );

  let scored = 0;
  for (const dir of dirs) {
    const infoPath = join(baseDir, dir, "info.json");
    const info = JSON.parse(readFileSync(infoPath, "utf8"));
    let score = 0;

    const stars = info.repo_stars || 0;
    if (stars > 0) score += Math.min(40, Math.log10(stars) * 20);

    // Scan all .md files in dir for content quality
    const mdFiles = readdirSync(join(baseDir, dir)).filter((f) => f.endsWith(".md"));
    for (const f of mdFiles) {
      const content = readFileSync(join(baseDir, dir, f), "utf8");
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
  return scored;
}

const s = scoreDir(join(ROOT, "skills"));
const c = scoreDir(join(ROOT, "commands"));
console.log(`score: ${s} skills, ${c} commands`);

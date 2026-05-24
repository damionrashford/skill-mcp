import * as fs from "node:fs";
import * as path from "node:path";
import type { Skill } from "./types.js";
import { parseFrontmatter, validateName } from "./frontmatter.js";

// Never descend into these — scanning them is either slow or nonsensical.
export const SKIP_DIRS = new Set([".git", "node_modules", ".svn", "__pycache__", ".tox", ".hg"]);

export function listFiles(dir: string): string[] {
  return [...new Bun.Glob("**/*").scanSync({ cwd: dir, onlyFiles: true })].sort();
}

export function fileMtime(absPath: string): string | undefined {
  try { return fs.statSync(absPath).mtime.toISOString(); } catch { return undefined; }
}

// Prefers SKILL.md; falls back to skill.md (per agentskills.io parser spec).
export function findSkillMd(skillDir: string): string | null {
  for (const name of ["SKILL.md", "skill.md"]) {
    const p = path.join(skillDir, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function scanSkillDirs(dirs: string[]): Map<string, Skill> {
  const catalog = new Map<string, Skill>();
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (SKIP_DIRS.has(entry.name)) continue;
      const skillDir = path.join(dir, entry.name);
      const skillMdPath = findSkillMd(skillDir);
      if (!skillMdPath) continue;

      const parsed = parseFrontmatter(fs.readFileSync(skillMdPath, "utf-8"));
      if (!parsed || !parsed.name || !parsed.description) continue;

      const nameErrors = validateName(parsed.name, entry.name);
      if (nameErrors.length > 0)
        console.error(`[agent-skills] warn: ${parsed.name}: ${nameErrors.join("; ")}`);
      if (parsed.description.length > 1024)
        console.error(`[agent-skills] warn: ${parsed.name}: description exceeds 1024 chars`);
      if (parsed.compatibility && parsed.compatibility.length > 500)
        console.error(`[agent-skills] warn: ${parsed.name}: compatibility exceeds 500 chars`);
      if (parsed.unknownFields.length > 0)
        console.error(`[agent-skills] warn: ${parsed.name}: unknown frontmatter fields: ${parsed.unknownFields.join(", ")}`);

      if (catalog.has(parsed.name)) {
        console.error(`[agent-skills] warn: skill '${parsed.name}' at '${skillDir}' shadowed by earlier-found skill at '${catalog.get(parsed.name)!.dir}'`);
        continue;
      }

      catalog.set(parsed.name, {
        name: parsed.name,
        description: parsed.description,
        dir: skillDir,
        body: parsed.body,
        files: listFiles(skillDir),
        license: parsed.license,
        compatibility: parsed.compatibility,
        allowedTools: parsed.allowedTools,
        metadata: parsed.metadata,
      });
    }
  }
  return catalog;
}

import type { ParsedFrontmatter } from "./types.js";

// Parses the 6 spec-defined fields from SKILL.md YAML frontmatter.
// Does not use a full YAML library — frontmatter is constrained by the spec.

export const ALLOWED_FIELDS = new Set([
  "name", "description", "license", "compatibility", "allowed-tools", "metadata",
]);

// Unicode-aware name validation (mirrors skills-ref validator.py).
// Name is NFKC-normalized before checks so decomposed unicode matches composed.
export function validateName(name: string, dirName: string): string[] {
  const n = name.normalize("NFKC");
  const errors: string[] = [];
  if (n.length > 64)
    errors.push(`name '${n}' exceeds 64-character limit (${n.length} chars)`);
  if (n !== n.toLowerCase())
    errors.push(`name '${n}' must be lowercase`);
  if (n.startsWith("-") || n.endsWith("-"))
    errors.push(`name '${n}' cannot start or end with a hyphen`);
  if (n.includes("--"))
    errors.push(`name '${n}' cannot contain consecutive hyphens`);
  if ([...n].some(c => c !== "-" && !c.match(/\p{L}|\p{N}/u)))
    errors.push(`name '${n}' contains invalid characters (only letters, digits, hyphens)`);
  if (dirName.normalize("NFKC") !== n)
    errors.push(`directory name '${dirName}' must match skill name '${n}'`);
  return errors;
}

export function parseFrontmatter(content: string): ParsedFrontmatter | null {
  if (!content.startsWith("---")) return null;
  const parts = content.split("---");
  if (parts.length < 3) return null;
  const yamlBlock = parts[1];
  const body = parts.slice(2).join("---").trimStart();

  const result: ParsedFrontmatter = { unknownFields: [], body };
  const lines = yamlBlock.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const m = line.match(/^([\w-]+):\s*(.*)/);
    if (!m) { i++; continue; }
    const key = m[1];
    const rawVal = m[2].trim();

    if (!ALLOWED_FIELDS.has(key)) {
      result.unknownFields.push(key);
      i++;
      continue;
    }

    if (key === "metadata") {
      const meta: Record<string, string> = {};
      i++;
      while (i < lines.length && /^\s/.test(lines[i])) {
        const kv = lines[i].match(/^\s+([^:]+):\s*(.*)/);
        if (kv) {
          const v = kv[2].trim().replace(/^["']|["']$/g, "");
          meta[kv[1].trim()] = String(v);
        }
        i++;
      }
      if (Object.keys(meta).length > 0) result.metadata = meta;
      continue;
    }

    // Scalar — handle YAML block scalars (> folded, | literal)
    let value = rawVal;
    if (rawVal === ">" || rawVal === "|") {
      const blockLines: string[] = [];
      i++;
      while (i < lines.length && /^\s/.test(lines[i])) {
        blockLines.push(lines[i].trim());
        i++;
      }
      value = rawVal === ">" ? blockLines.join(" ") : blockLines.join("\n");
    } else {
      i++;
    }
    value = value.replace(/^["']|["']$/g, "");

    if (key === "name")            result.name = value;
    else if (key === "description") result.description = value;
    else if (key === "license")     result.license = value;
    else if (key === "compatibility") result.compatibility = value;
    else if (key === "allowed-tools") result.allowedTools = value;
  }

  return result;
}

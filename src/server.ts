#!/usr/bin/env bun
/**
 * AgentSkills MCP server — prompts + resources + one tool.
 *
 * Prompts:   catalog (prompts/list) + activation (prompts/get)
 * Resources: skills://catalog                → <available_skills> XML
 *            skills://{skill}/source/{+path} → read file (text or blob)
 *            skills://{skill}/exec/{+path}   → execute script, return stdout
 * Tools:     skill → activate skill with ResourceLink content blocks
 *
 * Transport: stdio
 * Spec:      https://agentskills.io/specification
 */

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ErrorCode,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";

import { scanSkillDirs, findSkillMd, fileMtime } from "./lib/catalog.js";
import { mimeForPath, isBinaryMime } from "./lib/mime.js";
import { isScript, runScript } from "./lib/runner.js";
import { paginatePage } from "./lib/pagination.js";
import { escapeXml } from "./lib/xml.js";

const VERSION = "1.10.0";

// ─── Skill discovery ──────────────────────────────────────────────────────────

const SKILL_DIRS = [
  path.join(process.cwd(), ".agents", "skills"),
  path.join(process.cwd(), ".claude", "skills"),
  path.join(Bun.env.HOME ?? "", ".agents", "skills"),
  path.join(Bun.env.HOME ?? "", ".claude", "skills"),
];

const catalog = scanSkillDirs(SKILL_DIRS);
const server = new McpServer({ name: "agent-skills", version: VERSION });

// Sorted enum of all valid skill names — prevents hallucination of nonexistent names.
const skillNameEnum = catalog.size > 0
  ? z.enum([...catalog.keys()].sort() as [string, ...string[]])
  : z.string();

// ─── Prompts ──────────────────────────────────────────────────────────────────
// One prompt per skill:
//   prompts/list → Tier-1 catalog (name + description only)
//   prompts/get  → Tier-2 activation (body + manifest embedded resource)

for (const skill of catalog.values()) {
  const skillMdPath = findSkillMd(skill.dir)!;
  server.registerPrompt(
    skill.name,
    { title: skill.name, description: skill.description },
    () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `<skill name="${skill.name}">\n${skill.body}\n</skill>`,
            annotations: { audience: ["assistant"] as ("assistant" | "user")[], priority: 1.0 },
          },
        },
        {
          role: "user" as const,
          content: {
            type: "resource" as const,
            resource: {
              uri: `skills://${skill.name}/manifest`,
              mimeType: "application/json",
              text: JSON.stringify({
                skill: skill.name,
                location: skillMdPath,
                dir: skill.dir,
                files: skill.files,
                ...(skill.license        && { license: skill.license }),
                ...(skill.compatibility  && { compatibility: skill.compatibility }),
                ...(skill.allowedTools   && { "allowed-tools": skill.allowedTools }),
                ...(skill.metadata       && { metadata: skill.metadata }),
              }, null, 2),
            },
            annotations: {
              audience: ["assistant"] as ("assistant" | "user")[],
              priority: 0.9,
              lastModified: fileMtime(skillMdPath),
            },
          },
        },
      ],
    }),
  );
}

// ─── Completion helpers ───────────────────────────────────────────────────────
// Return the FULL filtered list — SDK's createCompletionResult slices to 100 and
// sets accurate total + hasMore from the full length.

function completeSkill(partial: string): string[] {
  const q = partial.toLowerCase();
  return [...catalog.keys()]
    .filter(k => q === "" || k.toLowerCase().includes(q))
    .sort((a, b) => {
      const aP = a.toLowerCase().startsWith(q) ? 0 : 1;
      const bP = b.toLowerCase().startsWith(q) ? 0 : 1;
      return aP - bP || a.localeCompare(b);
    });
}

function completePath(partial: string, skillName?: string, scriptsOnly = false): string[] {
  const candidates = skillName
    ? (catalog.get(skillName)?.files ?? []).filter(f => !scriptsOnly || isScript(f))
    : [...catalog.values()].flatMap(s => s.files.filter(f => !scriptsOnly || isScript(f)));
  const q = partial.toLowerCase();
  return candidates
    .filter(f => q === "" || f.toLowerCase().includes(q))
    .sort((a, b) => {
      const aP = a.toLowerCase().startsWith(q) ? 0 : 1;
      const bP = b.toLowerCase().startsWith(q) ? 0 : 1;
      return aP - bP || a.localeCompare(b);
    });
}

// ─── Resource: source file ────────────────────────────────────────────────────
// resources/read skills://{skill}/source/{+path} → file contents (idempotent)
// Binary files return BlobResourceContents; text files return TextResourceContents.

server.registerResource(
  "skill-source",
  new ResourceTemplate("skills://{skill}/source/{+path}", {
    list: undefined,
    complete: {
      skill: (partial) => completeSkill(partial),
      path: (partial, context) => completePath(partial, context?.arguments?.skill as string | undefined),
    },
  }),
  { title: "Skill Source File", description: "Read any file from a skill directory (scripts, references, assets)" },
  (uri: URL, vars: Record<string, string | string[]>) => {
    const skill = vars.skill as string;
    const filePath = vars.path as string;
    const s = catalog.get(skill);
    if (!s) throw new McpError(ErrorCode.InvalidParams, `Unknown skill: ${skill}`);
    const abs = path.resolve(s.dir, filePath);
    if (!abs.startsWith(path.resolve(s.dir))) throw new McpError(ErrorCode.InvalidParams, "Path traversal denied");
    if (!fs.existsSync(abs)) throw new McpError(-32002 as any, `Resource not found: ${filePath}`);
    const mime = mimeForPath(filePath);
    const contents = isBinaryMime(mime)
      ? { uri: uri.href, mimeType: mime, blob: fs.readFileSync(abs).toString("base64") }
      : { uri: uri.href, mimeType: mime, text: fs.readFileSync(abs, "utf-8") };
    return { contents: [contents] };
  },
);

// ─── Resource: exec script ────────────────────────────────────────────────────
// resources/read skills://{skill}/exec/{+path} → stdout of executed script
// Reading this URI runs the script — not idempotent. MCP spec §3 permits it.

server.registerResource(
  "skill-exec",
  new ResourceTemplate("skills://{skill}/exec/{+path}", {
    list: undefined,
    complete: {
      skill: (partial) => completeSkill(partial),
      path: (partial, context) => completePath(partial, context?.arguments?.skill as string | undefined, true),
    },
  }),
  { title: "Skill Script Execution", description: "Execute a skill script and return its stdout. Reading this URI runs the script — not idempotent." },
  async (uri: URL, vars: Record<string, string | string[]>) => {
    const skillName = vars.skill as string;
    const filePath = vars.path as string;
    const s = catalog.get(skillName);
    if (!s) throw new McpError(ErrorCode.InvalidParams, `Unknown skill: ${skillName}`);
    if (!isScript(filePath)) throw new McpError(ErrorCode.InvalidParams, `Not an executable script: ${filePath}`);
    const abs = path.resolve(s.dir, filePath);
    if (!abs.startsWith(path.resolve(s.dir))) throw new McpError(ErrorCode.InvalidParams, "Path traversal denied");
    if (!fs.existsSync(abs)) throw new McpError(-32002 as any, `Resource not found: ${filePath}`);
    const output = await runScript(abs, s.dir);
    return { contents: [{ uri: uri.href, mimeType: "text/plain", text: output }] };
  },
);

// ─── Resource: catalog XML ────────────────────────────────────────────────────
// Canonical <available_skills> XML per agentskills.io prompt.py spec.
// Includes <location> so models can resolve relative paths via file-read activation.

function buildCatalogXml(): string {
  if (catalog.size === 0) return "<available_skills>\n</available_skills>";
  const sorted = [...catalog.values()].sort((a, b) => a.name.localeCompare(b.name));
  const inner = sorted.map(s => {
    const loc = findSkillMd(s.dir);
    const lines = [
      "<skill>",
      `<name>${escapeXml(s.name)}</name>`,
      `<description>${escapeXml(s.description)}</description>`,
    ];
    if (loc) lines.push(`<location>${escapeXml(loc)}</location>`);
    lines.push("</skill>");
    return lines.join("\n");
  });
  return `<available_skills>\n${inner.join("\n")}\n</available_skills>`;
}

server.registerResource(
  "skill-catalog",
  "skills://catalog",
  {
    title: "Available Skills Catalog",
    description: "Available skills as <available_skills> XML — ready to inject into system prompts. " +
      "Includes <location> (absolute path to SKILL.md) for file-read activation and relative-path resolution.",
    mimeType: "application/xml",
  },
  () => ({
    contents: [{ uri: "skills://catalog", mimeType: "application/xml", text: buildCatalogXml() }],
  }),
);

// ─── Tool: skill ──────────────────────────────────────────────────────────────
// Tier-2 activation: <skill_content> text block + ResourceLink per file.
// Scripts → exec URI (read = run); other files → source URI (read = content).

if (catalog.size > 0) {
  server.registerTool(
    "skill",
    {
      description:
        "Load a skill's full instructions into context. Call when the current task matches " +
        "a skill's description. Returns the skill body in <skill_content> plus a ResourceLink " +
        "per file — scripts link to the exec URI (read = run), others to the source URI (read = content).",
      inputSchema: z.object({
        name: skillNameEnum.describe("Skill name (from prompts/list)"),
      }),
      outputSchema: z.object({
        name:          z.string().describe("Skill name"),
        body:          z.string().describe("Full skill instruction body"),
        dir:           z.string().describe("Absolute path to the skill directory"),
        files:         z.array(z.string()).describe("All files in the skill directory"),
        scripts:       z.array(z.string()).describe("Executable script files"),
        license:       z.string().optional(),
        compatibility: z.string().optional(),
        allowedTools:  z.string().optional(),
      }),
      annotations: {
        title: "Load Skill",
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
        destructiveHint: false,
      },
    },
    ({ name }) => {
      const s = catalog.get(name as string)!;

      const meta = [
        `Skill directory: ${s.dir}`,
        `Run scripts from this directory as CWD. Relative paths in skill instructions resolve against it.`,
        ...(s.compatibility ? [`Compatibility: ${s.compatibility}`] : []),
        ...(s.allowedTools  ? [`Allowed tools: ${s.allowedTools}`]  : []),
      ];

      const text = [`<skill_content name="${s.name}">`, s.body, "", meta.join("\n"), `</skill_content>`].join("\n");

      const structured = {
        name: s.name,
        body: s.body,
        dir: s.dir,
        files: s.files,
        scripts: s.files.filter(isScript),
        ...(s.license       && { license: s.license }),
        ...(s.compatibility && { compatibility: s.compatibility }),
        ...(s.allowedTools  && { allowedTools: s.allowedTools }),
      };

      const resourceLinks = s.files.map(f => {
        const abs = path.join(s.dir, f);
        const uri = isScript(f) ? `skills://${s.name}/exec/${f}` : `skills://${s.name}/source/${f}`;
        let size: number | undefined;
        try { size = fs.statSync(abs).size; } catch { /* not fatal */ }
        const segment = f.includes("/") ? f.split("/")[0] : null;
        const description = isScript(f)          ? "Executable script — read this URI to run it"
          : segment === "references"              ? "Reference document"
          : segment === "assets"                  ? "Asset file"
          : segment === "scripts"                 ? "Script file"
          :                                         "Skill file";
        return {
          type: "resource_link" as const,
          name: f,
          title: path.basename(f),
          description,
          uri,
          mimeType: mimeForPath(f),
          ...(size !== undefined && { size }),
          annotations: { audience: ["assistant"] as ("assistant" | "user")[], priority: 0.7 },
        };
      });

      return {
        content: [
          { type: "text" as const, text, annotations: { audience: ["assistant"] as ("assistant" | "user")[], priority: 1.0 } },
          // Backwards-compat JSON TextContent alongside structuredContent (spec §tools/structured-content)
          { type: "text" as const, text: JSON.stringify(structured), annotations: { audience: ["assistant"] as ("assistant" | "user")[], priority: 0.3 } },
          ...resourceLinks,
        ] as any,
        structuredContent: structured,
      } as any;
    },
  );
}

// ─── Handler overrides ────────────────────────────────────────────────────────
// McpServer v1 lacks cursor support on list handlers and doesn't expose
// resource templates via resources/templates/list. Override at the low-level.

const sortedPrompts = [...catalog.values()]
  .sort((a, b) => a.name.localeCompare(b.name))
  .map(s => ({ name: s.name, title: s.name, description: s.description }));

server.server.setRequestHandler(ListPromptsRequestSchema, (req) => {
  const { page, nextCursor } = paginatePage(sortedPrompts, req.params?.cursor);
  return nextCursor ? { prompts: page, nextCursor } : { prompts: page };
});

const RESOURCE_TEMPLATES = [
  {
    uriTemplate: "skills://{skill}/source/{+path}",
    name: "skill-source",
    title: "Skill Source File",
    description: "Read any file from a skill directory (scripts, references, assets)",
    annotations: { audience: ["user", "assistant"] as ("user" | "assistant")[] },
  },
  {
    uriTemplate: "skills://{skill}/exec/{+path}",
    name: "skill-exec",
    title: "Skill Script Execution",
    description: "Execute a skill script and return its stdout. Reading this URI runs the script — not idempotent.",
    annotations: { audience: ["assistant"] as ("user" | "assistant")[] },
  },
];

server.server.setRequestHandler(ListResourceTemplatesRequestSchema, (req) => {
  const { page, nextCursor } = paginatePage(RESOURCE_TEMPLATES, req.params?.cursor);
  return nextCursor ? { resourceTemplates: page, nextCursor } : { resourceTemplates: page };
});

// resources/list — compute catalog XML size dynamically for accurate size field.
server.server.setRequestHandler(ListResourcesRequestSchema, () => {
  const xml = buildCatalogXml();
  return {
    resources: [{
      uri: "skills://catalog",
      name: "skill-catalog",
      title: "Available Skills Catalog",
      description: "Available skills as <available_skills> XML — ready to inject into system prompts. " +
        "Includes <location> (absolute path to SKILL.md) for file-read activation and relative-path resolution.",
      mimeType: "application/xml",
      size: Buffer.byteLength(xml, "utf-8"),
    }],
  };
});

// tools/list — paginated with explicit execution + outputSchema fields.
const registeredTools = catalog.size > 0
  ? [{
      name: "skill",
      title: "Load Skill",
      description:
        "Load a skill's full instructions into context. Call when the current task matches " +
        "a skill's description. Returns the skill body in <skill_content> plus a ResourceLink " +
        "per file — scripts link to the exec URI (read = run), others to the source URI (read = content).",
      inputSchema: {
        type: "object" as const,
        properties: {
          name: { type: "string", description: "Skill name (from prompts/list)", enum: [...catalog.keys()].sort() },
        },
        required: ["name"],
      },
      outputSchema: {
        type: "object" as const,
        properties: {
          name:          { type: "string" },
          body:          { type: "string" },
          dir:           { type: "string" },
          files:         { type: "array", items: { type: "string" } },
          scripts:       { type: "array", items: { type: "string" } },
          license:       { type: "string" },
          compatibility: { type: "string" },
          allowedTools:  { type: "string" },
        },
        required: ["name", "body", "dir", "files", "scripts"],
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false, destructiveHint: false },
      execution: { taskSupport: "forbidden" as const },
    }]
  : [];

server.server.setRequestHandler(ListToolsRequestSchema, (req) => {
  const { page, nextCursor } = paginatePage(registeredTools, req.params?.cursor);
  return nextCursor ? { tools: page, nextCursor } : { tools: page };
});

// ─── Subscriptions ────────────────────────────────────────────────────────────
// Catalog is static at runtime so we never emit notifications/resources/updated,
// but accepting subscriptions is required when subscribe capability is declared.

const resourceSubscribers = new Set<string>();
server.server.registerCapabilities({ resources: { subscribe: true } });
server.server.setRequestHandler(SubscribeRequestSchema, (req) => { resourceSubscribers.add(req.params.uri); return {}; });
server.server.setRequestHandler(UnsubscribeRequestSchema, (req) => { resourceSubscribers.delete(req.params.uri); return {}; });

// ─── Logging capability ───────────────────────────────────────────────────────
// Activates the built-in logging/setLevel handler and enables sendLoggingMessage().

server.server.registerCapabilities({ logging: {} });

// ─── Connect ──────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[agent-skills] v${VERSION} — ${catalog.size} skills: ${[...catalog.keys()].join(", ")}`);
await server.sendLoggingMessage({
  level: "info",
  logger: "agent-skills",
  data: { version: `v${VERSION}`, skillCount: catalog.size, skills: [...catalog.keys()].sort() },
});

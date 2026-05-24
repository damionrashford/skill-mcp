<div align="center">

<h1>agent-skills-mcp</h1>

<p>The MCP server for <a href="https://agentskills.io">AgentSkills</a>.<br>
Expose your local skills as prompts, resources, and tools — over stdio, spec-compliant with MCP 2025-11-25.</p>

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)&nbsp;[![Bun](https://img.shields.io/badge/Bun-1.1+-fbf0df?logo=bun&logoColor=black)](https://bun.sh)&nbsp;[![MCP](https://img.shields.io/badge/MCP-2025--11--25-6366f1)](https://modelcontextprotocol.io/specification/2025-11-25)&nbsp;[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e)](./LICENSE)

<p>
Works with&nbsp;
<strong>Claude Desktop</strong> &nbsp;·&nbsp; <strong>Claude Code</strong> &nbsp;·&nbsp; <strong>Cursor</strong> &nbsp;·&nbsp; <strong>Cline</strong> &nbsp;·&nbsp; <strong>Windsurf</strong><br>
and any MCP-compatible client
</p>

</div>

---

## Protocol surfaces

Skills are auto-discovered at startup and surfaced across all three MCP protocol surfaces:

| Surface | URI / Name | What you get |
|:--------|:-----------|:------------|
| **Prompts** | `{skill-name}` | Full skill body + embedded file manifest |
| **Resources** | `skills://{skill}/source/{+path}` | Any file from the skill directory (text or binary) |
| **Resources** | `skills://{skill}/exec/{+path}` | Execute a skill script, capture stdout |
| **Resources** | `skills://catalog` | `<available_skills>` XML for system-prompt injection |
| **Tools** | `skill` | Full activation: `<skill_content>` block + one ResourceLink per file |

---

## Quick start

```bash
bun start               # run the server (stdio)
bun --watch src/server.ts  # hot-reload during development
```

<br>

**Claude Desktop** — edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "agent-skills": {
      "command": "bun",
      "args": ["/path/to/skill-mcp/src/server.ts"]
    }
  }
}
```

**Claude Code** — edit `~/.claude/mcp_servers.json` (global) or `.mcp.json` at project root:

```json
{
  "mcpServers": {
    "agent-skills": {
      "command": "bun",
      "args": ["/path/to/skill-mcp/src/server.ts"]
    }
  }
}
```

<details>
<summary><strong>Cursor</strong> — Settings → MCP → Add Server</summary>

```json
{
  "agent-skills": {
    "command": "bun",
    "args": ["/path/to/skill-mcp/src/server.ts"]
  }
}
```
</details>

<details>
<summary><strong>Cline (VS Code)</strong> — MCP Servers panel → Edit MCP Settings</summary>

```json
{
  "agent-skills": {
    "command": "bun",
    "args": ["/path/to/skill-mcp/src/server.ts"],
    "transport": "stdio"
  }
}
```
</details>

---

## Skill discovery

On startup the server scans these directories in order — first match wins per skill name:

| Priority | Path | Scope |
|:--------:|:-----|:------|
| 1 | `{cwd}/.agents/skills/` | Project-local |
| 2 | `{cwd}/.claude/skills/` | Claude Code project |
| 3 | `~/.agents/skills/` | User-global |
| 4 | `~/.claude/skills/` | Claude Code global |

Each skill is a directory containing a `SKILL.md` (or `skill.md`) at its root.

---

## Skill format

```markdown
---
name: my-skill
description: One-line description shown in prompts/list (max 1024 chars)
license: MIT                       # optional
compatibility: Claude Code, Cursor  # optional
allowed-tools: Read, Bash          # optional
---

# My Skill

Full skill body — any Markdown.
Scripts in the directory are auto-detected and executable via the exec surface.
```

Scripts are detected by extension and run with the appropriate runner:

| Extension | Runner |
|:----------|:-------|
| `.py` | `uv run` |
| `.ts` · `.tsx` · `.js` · `.mjs` | `bun` |
| `.sh` · `.bash` | `bash` |
| `.rb` | `ruby` |
| `.go` | `go run` |

---

## Protocol compliance

Full MCP 2025-11-25 implementation across every protocol surface:

| Feature | Coverage |
|:--------|:---------|
| **Prompts** | `prompts/list` (cursor-paginated) · `prompts/get` · `list_changed` notification |
| **Resources** | `resources/list` (with `size`) · templates (paginated) · `resources/read` text + binary · subscribe / unsubscribe |
| **Tools** | `tools/list` (paginated) · `structuredContent` + `outputSchema` · `execution` field · backwards-compat TextContent |
| **Completion** | `completion/complete` for `{skill}` and `{+path}` with accurate `total` + `hasMore` |
| **Logging** | `logging` capability · `setLevel` · startup `notifications/message` |
| **Annotations** | `audience` · `priority` · `lastModified` on all content blocks |

---

## Project layout

```
skill-mcp/
├── src/
│   ├── server.ts          # Entry point — MCP registrations + connect
│   └── lib/
│       ├── types.ts       # Skill + ParsedFrontmatter interfaces
│       ├── frontmatter.ts # YAML parser, validateName
│       ├── catalog.ts     # Skill discovery (scanSkillDirs)
│       ├── mime.ts        # mimeForPath, isBinaryMime
│       ├── runner.ts      # isScript, detectRunner, runScript
│       ├── pagination.ts  # Cursor-based pagination helpers
│       └── xml.ts         # escapeXml
└── test/
    └── integration.ts     # End-to-end — spawns server, exercises all surfaces
```

---

## Development

```bash
bun start                    # run
bun test                     # integration test
bun typecheck                # tsc --noEmit
bun --watch src/server.ts    # hot-reload
```

**Requirements:** [Bun](https://bun.sh) ≥ 1.1 · `@modelcontextprotocol/sdk` ^1.29.0 (auto-installed)

---

<div align="center">

[AgentSkills spec](https://agentskills.io) &nbsp;·&nbsp; [MCP 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25) &nbsp;·&nbsp; [MCP Registry](https://github.com/modelcontextprotocol/registry)

<sub>MIT License</sub>

</div>

# agent-skills-mcp

**The MCP server for [AgentSkills](https://agentskills.io).** Expose your local skills as prompts, resources, and tools — fully spec-compliant with MCP 2025-11-25.

Works with **Claude Desktop**, **Claude Code**, **Cursor**, **Cline**, **Windsurf**, and any other MCP-compatible client.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1.1+-fbf0df?logo=bun&logoColor=black)](https://bun.sh)
[![MCP](https://img.shields.io/badge/MCP-2025--11--25-6366f1)](https://modelcontextprotocol.io/specification/2025-11-25)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

---

## What it does

Skills are auto-discovered at startup and surfaced across all three MCP protocol surfaces:

| Surface | URI / Name | What you get |
|---|---|---|
| `prompts/list` + `prompts/get` | `{skill-name}` | Full skill body + embedded file manifest |
| `resources/read` | `skills://{skill}/source/{+path}` | Any file from the skill directory (text or binary) |
| `resources/read` | `skills://{skill}/exec/{+path}` | Execute a skill script, stream stdout back |
| `resources/read` | `skills://catalog` | `<available_skills>` XML block for system-prompt injection |
| `tools/call` | `skill` | Full activation: `<skill_content>` block + one ResourceLink per file |

---

## Quick start

```bash
# Run the server (stdio transport)
bun src/server.ts

# Or via the package script
bun start
```

### Add to Claude Desktop

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

### Add to Claude Code

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

Config file: `~/.claude/mcp_servers.json` (global) or `.mcp.json` at project root.

### Add to Cursor

In **Cursor Settings → MCP → Add Server**:

```json
{
  "agent-skills": {
    "command": "bun",
    "args": ["/path/to/skill-mcp/src/server.ts"]
  }
}
```

### Add to Cline (VS Code)

In Cline's **MCP Servers** panel → **Edit MCP Settings**:

```json
{
  "agent-skills": {
    "command": "bun",
    "args": ["/path/to/skill-mcp/src/server.ts"],
    "transport": "stdio"
  }
}
```

---

## Skill discovery

Skills are scanned from these directories on startup (first match wins per skill name):

```
{cwd}/.agents/skills/    ← project-local (checked first)
{cwd}/.claude/skills/    ← Claude Code project skills
~/.agents/skills/         ← user-global
~/.claude/skills/         ← Claude Code global skills
```

Each skill is a directory with a `SKILL.md` (or `skill.md`) at its root.

---

## Skill format

```markdown
---
name: my-skill
description: One-line description shown in prompts/list (max 1024 chars)
license: MIT                    # optional
compatibility: Claude Code      # optional — e.g. "Claude Code, Cursor"
allowed-tools: Read, Bash       # optional — space or comma separated
---

# My Skill

Full skill body. Supports any Markdown.
Scripts in the directory are auto-detected and executable via resources/exec.
```

### Supported script runners

| Extension | Runner |
|---|---|
| `.py` | `uv run` |
| `.ts` / `.tsx` / `.js` / `.mjs` | `bun` |
| `.sh` / `.bash` | `bash` |
| `.rb` | `ruby` |
| `.go` | `go run` |

---

## Protocol compliance

Full MCP 2025-11-25 implementation:

- **Prompts** — `prompts/list` (cursor-paginated), `prompts/get`, `notifications/prompts/list_changed`
- **Resources** — `resources/list` (with `size`), `resources/templates/list` (paginated), `resources/read` (text + binary blob), `resources/subscribe` / `resources/unsubscribe`
- **Tools** — `tools/list` (paginated, with `execution` + `outputSchema`), `tools/call` (returns `structuredContent` + backwards-compat JSON TextContent + ResourceLink blocks)
- **Completion** — `completion/complete` for both `{skill}` and `{+path}` URI variables with accurate `total` + `hasMore`
- **Logging** — `logging` capability, `logging/setLevel`, startup `notifications/message`
- **Annotations** — `audience`, `priority`, `lastModified` on all content blocks

---

## Project structure

```
skill-mcp/
├── src/
│   ├── server.ts          # Entry point — MCP registrations + connect
│   └── lib/
│       ├── types.ts       # Skill + ParsedFrontmatter interfaces
│       ├── frontmatter.ts # YAML frontmatter parser, validateName
│       ├── catalog.ts     # Skill discovery (scanSkillDirs)
│       ├── mime.ts        # mimeForPath, isBinaryMime
│       ├── runner.ts      # isScript, detectRunner, runScript
│       ├── pagination.ts  # Cursor-based pagination helpers
│       └── xml.ts         # escapeXml
└── test/
    └── integration.ts     # End-to-end test (spawns server over stdio)
```

---

## Development

```bash
bun start          # run the server
bun test           # integration test — spawns server, exercises all 4 surfaces
bun typecheck      # tsc --noEmit (no output on success)
bun --watch src/server.ts  # hot-reload
```

---

## Requirements

- [Bun](https://bun.sh) ≥ 1.1
- `@modelcontextprotocol/sdk` ^1.29.0 (auto-installed via `bun install`)

---

## Related

- [AgentSkills](https://agentskills.io) — the skill specification this server implements
- [MCP specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25) — the protocol spec
- [modelcontextprotocol/registry](https://github.com/modelcontextprotocol/registry) — community MCP server registry

---

## License

MIT

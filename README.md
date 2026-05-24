# agent-skills-mcp

MCP server that exposes [AgentSkills](https://agentskills.io) as prompts, resources, and tools — fully spec-compliant with MCP 2025-11-25.

## What it does

Skills are discovered from well-known directories on startup and exposed through three protocol surfaces:

| Surface | URI / name | What you get |
|---|---|---|
| `prompts/list` | — | Paginated catalog of all skills (name + description) |
| `prompts/get` | `{skill-name}` | Full skill body + manifest (dir, files, metadata) |
| `resources/read` | `skills://{skill}/source/{+path}` | Any file from a skill directory (text or binary) |
| `resources/read` | `skills://{skill}/exec/{+path}` | Execute a skill script, return stdout |
| `resources/read` | `skills://catalog` | `<available_skills>` XML for system-prompt injection |
| `tools/call` | `skill` | Full activation: `<skill_content>` + ResourceLink per file |

## Quick start

```bash
# Run the server (stdio transport)
bun start

# Run the integration test
bun test

# Type-check without running
bun typecheck
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

## Skill discovery

Skills are scanned from these directories (in order, first match wins):

1. `{cwd}/.agents/skills/`
2. `{cwd}/.claude/skills/`
3. `~/.agents/skills/`
4. `~/.claude/skills/`

Each skill is a directory containing a `SKILL.md` (or `skill.md`) with YAML frontmatter:

```markdown
---
name: my-skill
description: One-line description shown in prompts/list (max 1024 chars)
license: MIT                    # optional
compatibility: Claude Code      # optional
allowed-tools: Read, Bash       # optional, space-separated
---

# My Skill

Skill body shown on prompts/get and tools/skill...
```

## Protocol compliance

Implements MCP 2025-11-25:

- **Prompts** — `prompts/list` (paginated), `prompts/get`, `notifications/prompts/list_changed`
- **Resources** — `resources/list` (with `size`), `resources/templates/list` (paginated), `resources/read` (text + binary blob), `resources/subscribe` / `resources/unsubscribe`
- **Tools** — `tools/list` (paginated, with `execution` + `outputSchema`), `tools/call` (returns `structuredContent` + backwards-compat JSON TextContent + ResourceLink blocks)
- **Completion** — `completion/complete` for both `{skill}` and `{+path}` variables with accurate `total` + `hasMore`
- **Logging** — `logging` capability, `logging/setLevel`, startup `notifications/message`
- **Annotations** — `audience`, `priority`, `lastModified` on all content blocks

## Project structure

```
src/
  server.ts          # Entry point — MCP registrations + connect
  lib/
    types.ts         # Skill + ParsedFrontmatter interfaces
    frontmatter.ts   # YAML frontmatter parser, validateName
    catalog.ts       # Skill discovery (scanSkillDirs)
    mime.ts          # mimeForPath, isBinaryMime
    runner.ts        # isScript, detectRunner, runScript
    pagination.ts    # Cursor-based pagination helpers
    xml.ts           # escapeXml
test/
  integration.ts     # End-to-end test (spawns server over stdio)
```

## Requirements

- [Bun](https://bun.sh) ≥ 1.1
- `@modelcontextprotocol/sdk` ^1.29.0 (installed via `bun install`)

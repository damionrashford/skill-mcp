# skill-mcp — Claude instructions

MCP server for AgentSkills. Entry point: `src/server.ts`. Transport: stdio.

## Commands

```bash
bun start          # run the server
bun test           # integration test (spawns server, exercises all 4 protocol surfaces)
bun typecheck      # tsc --noEmit, no output on success
bun --watch src/server.ts  # hot-reload during development
```

## Architecture

`src/server.ts` imports pure utility modules from `src/lib/` and wires everything into the McpServer instance. The lib modules have no MCP imports — they're plain TypeScript.

| Module | Owns |
|---|---|
| `lib/types.ts` | `Skill`, `ParsedFrontmatter` interfaces |
| `lib/frontmatter.ts` | YAML parser, `validateName` |
| `lib/catalog.ts` | `scanSkillDirs`, `findSkillMd`, `fileMtime` |
| `lib/mime.ts` | `mimeForPath`, `isBinaryMime` |
| `lib/runner.ts` | `isScript`, `detectRunner`, `runScript` |
| `lib/pagination.ts` | `encodeCursor`, `decodeCursor`, `paginatePage` |
| `lib/xml.ts` | `escapeXml` |

## Key patterns

**Low-level handler overrides** — `server.server.setRequestHandler(SomeSchema, ...)` bypasses `McpServer`'s `assertCanSetRequestHandler` guard and overwrites the built-in handler. This pattern is used for:
- `ListPromptsRequestSchema` — adds cursor pagination (McpServer v1 has none)
- `ListResourceTemplatesRequestSchema` — exposes templates (McpServer v1 doesn't emit this)
- `ListResourcesRequestSchema` — adds `size` field computed at request time
- `ListToolsRequestSchema` — adds cursor pagination + explicit `execution` / `outputSchema`
- `SubscribeRequestSchema` / `UnsubscribeRequestSchema` — accepts subscriptions (catalog is static, no notifications emitted)

When adding a new override, call `server.server.setRequestHandler(...)` AFTER all `server.register*()` calls so it reliably overwrites the built-in.

**ResourceLink blocks** — the `skill` tool returns `{ type: "resource_link" }` content blocks (MCP 2025-11-25 type). These require `as any` casts because the v1 SDK's TypeScript union doesn't include `resource_link` yet. Don't "fix" the cast — it's load-bearing.

**structuredContent** — the `skill` tool returns both `structuredContent` (machine-readable JSON) and a low-priority TextContent block with `JSON.stringify(structured)` for backwards compatibility with clients that don't support `structuredContent`. Both must stay.

**Binary files** — `isBinaryMime()` decides whether to return `{ blob: base64 }` vs `{ text: utf8 }`. Always route through this — never call `readFileSync(path, "utf-8")` on an unknown file path.

**Completion slicing** — do NOT slice completion arrays in `completeSkill()` or `completePath()`. The SDK's internal `createCompletionResult()` slices to 100 and computes accurate `total` + `hasMore`. Pre-slicing breaks those fields.

**Error codes** — use `ErrorCode.InvalidParams` (`-32602`) for bad input (unknown skill, not a script, path traversal). Use raw `-32002` for "file not found" (MCP spec §resources). The `-32002` code is not in the SDK enum; cast: `new McpError(-32002 as any, ...)`.

## MCP SDK version

`@modelcontextprotocol/sdk@^1.29.0` (v1 stable). `main` branch of the SDK is v2 pre-alpha — don't upgrade without verifying API compatibility. Key difference: v2 uses `@modelcontextprotocol/server` / `@modelcontextprotocol/client` split packages.

## Version bumping

Version string lives in `VERSION` constant at the top of `src/server.ts` and is mirrored in `package.json`. Update both together.

## Do not

- Add `package.json` inside `src/lib/` or skill directories — breaks Bun auto-install nesting
- Use `node:fs` for new code in `src/lib/` — prefer Bun APIs (`Bun.Glob`, `Bun.file`)
- Pre-slice completion arrays (see above)
- Call `console.error` for runtime errors after connect — use `server.sendLoggingMessage()` instead
- Remove the `as any` casts on ResourceLink content arrays or McpError `-32002`

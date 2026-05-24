#!/usr/bin/env bun
/**
 * Integration test for the AgentSkills MCP server.
 * Spawns the server over stdio and exercises all four protocol surfaces.
 *
 * 1. prompts/list   — paginated catalog
 * 2. prompts/get    — full activation (body + embedded manifest)
 * 3. resources/read — source file via skills://{skill}/source/{+path}
 * 4. tools/skill    — structured <skill_content> activation
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as path from "path";

const SERVER = path.join(import.meta.dir, "../src/server.ts");

const transport = new StdioClientTransport({ command: "bun", args: [SERVER] });
const client = new Client({ name: "skill-mcp-test", version: "1.0.0" });
await client.connect(transport);

const sep = (label: string) => console.log(`\n${"─".repeat(60)}\n${label}\n${"─".repeat(60)}`);

// ── 1. prompts/list ───────────────────────────────────────────────────────────
sep("prompts/list  →  catalog");
const { prompts } = await client.listPrompts();
console.log(`Found ${prompts.length} skills (page 1):`);
for (const p of prompts.slice(0, 5)) {
  console.log(`  • ${p.name}`);
  console.log(`    ${p.description?.slice(0, 100)}...`);
}
if (prompts.length === 20) console.log("  … (paginated — more pages available)");

// ── 2. prompts/get ────────────────────────────────────────────────────────────
const target = prompts.find(p => p.name === "gh") ?? prompts[0];
sep(`prompts/get("${target.name}")  →  activation`);
const activated = await client.getPrompt({ name: target.name });
for (const msg of activated.messages) {
  if (msg.content.type === "text") {
    console.log(`[role: ${msg.role}] text (${msg.content.text.length} chars):`);
    console.log(msg.content.text.slice(0, 300) + "...");
  } else if (msg.content.type === "resource") {
    const res = msg.content.resource;
    console.log(`[role: ${msg.role}] embedded resource: ${res.uri}`);
    if ("text" in res) {
      const manifest = JSON.parse(res.text);
      console.log(`  dir:   ${manifest.dir}`);
      console.log(`  files: ${manifest.files.slice(0, 5).join(", ")}${manifest.files.length > 5 ? " …" : ""}`);
    }
  }
}

// ── 3. resources/read ─────────────────────────────────────────────────────────
sep("resources/read  →  source file");
const manifestMsg = activated.messages.find(m => m.content.type === "resource");
if (manifestMsg && manifestMsg.content.type === "resource") {
  const res = manifestMsg.content.resource as { text: string };
  const manifest = JSON.parse(res.text);
  const firstFile = manifest.files[0];
  if (firstFile) {
    const uri = `skills://${target.name}/source/${firstFile}`;
    console.log(`Reading: ${uri}`);
    const result = await client.readResource({ uri });
    const content = result.contents[0] as Record<string, unknown>;
    if (typeof content.text === "string") {
      console.log(`Got ${content.text.length} chars:`);
      console.log(content.text.slice(0, 400) + "...");
    }
  }
}

// ── 4. tools/skill ────────────────────────────────────────────────────────────
sep(`tools/skill("${target.name}")  →  structured activation`);
const skillResult = await client.callTool({ name: "skill", arguments: { name: target.name } });
const items = Array.isArray(skillResult.content) ? skillResult.content : [];
for (const item of items) {
  if (item.type === "text") {
    console.log(`text (${item.text.length} chars):`);
    console.log(item.text.slice(0, 500));
  }
}

sep("DONE");
await client.close();

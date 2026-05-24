import * as path from "node:path";

export const SCRIPT_EXTS = new Set([".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".sh", ".bash", ".rb", ".go"]);

export function isScript(filePath: string): boolean {
  return SCRIPT_EXTS.has(path.extname(filePath).toLowerCase());
}

// Runner per extension — matches stack conventions (.py → uv run, .ts/.js → bun, etc.)
export function detectRunner(scriptPath: string): string[] {
  switch (path.extname(scriptPath).toLowerCase()) {
    case ".py":                              return ["uv", "run"];
    case ".ts":   case ".tsx":              return ["bun"];
    case ".js":   case ".jsx": case ".mjs": return ["bun"];
    case ".sh":   case ".bash":             return ["bash"];
    case ".rb":                             return ["ruby"];
    case ".go":                             return ["go", "run"];
    default:                                return ["bash"];
  }
}

export async function runScript(abs: string, cwd: string, args: string[] = [], timeoutMs = 30_000): Promise<string> {
  const proc = Bun.spawn([...detectRunner(abs), abs, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdoutP = new Response(proc.stdout).text();
  const stderrP = new Response(proc.stderr).text();

  const result = await Promise.race([
    proc.exited.then(() => "done" as const),
    new Promise<"timeout">(resolve =>
      setTimeout(() => { proc.kill(); resolve("timeout"); }, timeoutMs),
    ),
  ]);

  if (result === "timeout") throw new Error(`Script timed out after ${timeoutMs / 1000}s`);

  const [stdout, stderr] = await Promise.all([stdoutP, stderrP]);
  if ((proc.exitCode ?? 0) !== 0)
    throw new Error(`Script exited with code ${proc.exitCode}:\n${stderr || stdout}`);
  return stdout || "(script completed with no output)";
}

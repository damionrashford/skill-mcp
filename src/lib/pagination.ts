import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

export const PAGE_SIZE = 20;

export function encodeCursor(offset: number): string {
  return btoa(JSON.stringify({ v: 1, offset }));
}

export function decodeCursor(raw: string): number {
  try {
    const parsed = JSON.parse(atob(raw));
    if (parsed.v !== 1 || typeof parsed.offset !== "number" || parsed.offset < 0) throw 0;
    return parsed.offset;
  } catch {
    throw new McpError(ErrorCode.InvalidParams, "Invalid cursor");
  }
}

export function paginatePage<T>(items: T[], cursor?: string): { page: T[]; nextCursor?: string } {
  const offset = cursor ? decodeCursor(cursor) : 0;
  const page = items.slice(offset, offset + PAGE_SIZE);
  const nextCursor = offset + PAGE_SIZE < items.length ? encodeCursor(offset + PAGE_SIZE) : undefined;
  return { page, nextCursor };
}

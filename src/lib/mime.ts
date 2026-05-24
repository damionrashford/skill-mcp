import * as path from "node:path";

// MIME type from file extension — used by resources/read and ResourceLink listings.
// Correct types matter: MCP clients use mimeType for syntax rendering and routing.
export function mimeForPath(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    // Text / code
    case ".ts":   case ".tsx":               return "text/x-typescript";
    case ".js":   case ".jsx":  case ".mjs": return "text/javascript";
    case ".py":                              return "text/x-python";
    case ".sh":   case ".bash":              return "text/x-shellscript";
    case ".rb":                              return "text/x-ruby";
    case ".go":                              return "text/x-go";
    case ".rs":                              return "text/x-rustsrc";
    case ".md":                              return "text/markdown";
    case ".json":                            return "application/json";
    case ".yaml": case ".yml":               return "application/yaml";
    case ".toml":                            return "application/toml";
    case ".html": case ".htm":               return "text/html";
    case ".css":                             return "text/css";
    case ".xml":                             return "application/xml";
    case ".txt":                             return "text/plain";
    case ".csv":                             return "text/csv";
    // Binary — must be returned as BlobResourceContents, not text
    case ".pdf":                             return "application/pdf";
    case ".png":                             return "image/png";
    case ".jpg":  case ".jpeg":              return "image/jpeg";
    case ".gif":                             return "image/gif";
    case ".webp":                            return "image/webp";
    case ".svg":                             return "image/svg+xml";
    case ".ico":                             return "image/x-icon";
    case ".wasm":                            return "application/wasm";
    case ".zip":                             return "application/zip";
    case ".ttf":                             return "font/ttf";
    case ".otf":                             return "font/otf";
    case ".woff":                            return "font/woff";
    case ".woff2":                           return "font/woff2";
    default:                                 return "text/plain";
  }
}

// Returns true for MIME types whose content must be base64-encoded (BlobResourceContents).
export function isBinaryMime(mime: string): boolean {
  return mime.startsWith("image/") ||
         mime.startsWith("font/") ||
         mime === "application/pdf" ||
         mime === "application/wasm" ||
         mime === "application/zip" ||
         mime === "application/octet-stream";
}

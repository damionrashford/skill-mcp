export interface Skill {
  name: string;
  description: string;
  dir: string;
  body: string;
  files: string[];
  license?: string;
  compatibility?: string;
  allowedTools?: string;
  metadata?: Record<string, string>;
}

export interface ParsedFrontmatter {
  name?: string;
  description?: string;
  license?: string;
  compatibility?: string;
  allowedTools?: string;
  metadata?: Record<string, string>;
  unknownFields: string[];
  body: string;
}

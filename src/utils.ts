import matter from "gray-matter";
import * as path from "node:path";
import * as fs from "node:fs";
import type { HarnessConfig, McpServer, Skill } from "./schema.js";


export interface FrontmatterResult {
  data: Record<string, unknown>;
  content: string;
}

export function parseFrontmatter(raw: string): FrontmatterResult {
  const { data, content } = matter(raw);
  return { data, content: content.trim() };
}

export function serializeFrontmatter(
  data: Record<string, unknown>,
  body: string,
): string {
  const clean = Object.fromEntries(
    Object.entries(data).filter(([, v]) => v != null),
  );
  if (Object.keys(clean).length === 0) {
    return body;
  }
  return matter.stringify(body, clean);
}

// --- Typed frontmatter accessors ---
// Eliminates repetitive `as` casts on `Record<string, unknown>` values.

export function getString(
  data: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = data[key];
  return typeof v === "string" ? v : undefined;
}

export function getStringOrFallback(
  data: Record<string, unknown>,
  key: string,
  fallback: string,
): string {
  return getString(data, key) ?? fallback;
}

export function getBoolean(
  data: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const v = data[key];
  return typeof v === "boolean" ? v : undefined;
}

export function getNumber(
  data: Record<string, unknown>,
  key: string,
): number | undefined {
  const v = data[key];
  return typeof v === "number" ? v : undefined;
}

export function getStringArray(
  data: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const v = data[key];
  if (Array.isArray(v)) return v.filter((el): el is string => typeof el === "string");
  return undefined;
}

export function getRecord(
  data: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const v = data[key];
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return undefined;
}

/**
 * Parse globs from frontmatter: accepts string or string[].
 */
export function getGlobs(
  data: Record<string, unknown>,
  key: string = "globs",
): string | undefined {
  const v = data[key];
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.filter((el): el is string => typeof el === "string").join(",");
  return undefined;
}

/**
 * Get a Record<string, string> from an object key, validating that
 * all values are strings. Filters out non-string values.
 */
export function getStringRecord(
  data: Record<string, unknown>,
  key: string,
): Record<string, string> | undefined {
  const v = data[key];
  if (v === null || typeof v !== "object" || Array.isArray(v)) return undefined;
  const entries = Object.entries(v as Record<string, unknown>).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}


export function readFileIfExists(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch { /* file does not exist or is unreadable */
    return undefined;
  }
}

export function readJsonIfExists(filePath: string): unknown {
  const raw = readFileIfExists(filePath);
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch { /* malformed JSON */
    return undefined;
  }
}

/**
 * Read a JSON file and validate its shape with a type guard.
 * Returns undefined if file doesn't exist, isn't valid JSON, or fails the guard.
 */
export function readJsonAs<T>(
  filePath: string,
  guard: (v: unknown) => v is T,
): T | undefined {
  const raw = readJsonIfExists(filePath);
  if (raw === undefined) return undefined;
  return guard(raw) ? raw : undefined;
}

export function listMdFiles(dirPath: string): string[] {
  try {
    return fs
      .readdirSync(dirPath)
      .filter((f) => f.endsWith(".md"))
      .map((f) => path.join(dirPath, f));
  } catch { /* directory does not exist */
    return [];
  }
}

export function listSubdirs(dirPath: string): string[] {
  try {
    return fs
      .readdirSync(dirPath, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(dirPath, d.name));
  } catch { /* directory does not exist */
    return [];
  }
}

export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function slugify(name: string): string {
  return name.toLowerCase().replaceAll(/[^a-z0-9-]/g, "-");
}

/**
 * Write a file only if not in dry-run mode. Ensures parent directory exists.
 */
export function writeIfNotDry(
  filePath: string,
  content: string,
  dryRun: boolean,
): void {
  if (!dryRun) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, content);
  }
}

// --- Shared import/export helpers ---
// These eliminate duplicated skill/MCP parsing across converters.

/**
 * Parse a single SKILL.md file into a Skill object.
 */
function parseSkillMd(raw: string, fallbackName: string): Skill {
  const { data, content } = parseFrontmatter(raw);
  return {
    name: getStringOrFallback(data, "name", fallbackName),
    description: getString(data, "description"),
    body: content,
  };
}

/**
 * Import skills from a directory containing `<name>/SKILL.md` subdirs.
 * Optionally scans one level of nested subdirs and flat .md files.
 */
export function importSkillsFromDir(
  skillsDir: string,
  options: { nested?: boolean; flatMd?: boolean } = {},
): Skill[] {
  const fromSubdirs = listSubdirs(skillsDir).flatMap((subDir) => {
    const main = readFileIfExists(path.join(subDir, "SKILL.md"));
    const results = main ? [parseSkillMd(main, path.basename(subDir))] : [];

    if (options.nested) {
      const nested = listSubdirs(subDir).flatMap((nestedDir) => {
        const nestedMd = readFileIfExists(path.join(nestedDir, "SKILL.md"));
        return nestedMd ? [parseSkillMd(nestedMd, path.basename(nestedDir))] : [];
      });
      results.push(...nested);
    }

    return results;
  });

  const fromFlatMd = options.flatMd
    ? listMdFiles(skillsDir).map((filePath) => {
        const raw = fs.readFileSync(filePath, "utf-8");
        return parseSkillMd(raw, path.basename(filePath, ".md"));
      })
    : [];

  return [...fromSubdirs, ...fromFlatMd];
}

/**
 * Export skills to `<baseDir>/<dirName>/SKILL.md` format.
 */
export function exportSkillsToDir(
  baseDir: string,
  skills: Skill[],
  dryRun: boolean,
): string[] {
  const files: string[] = [];
  for (const skill of skills) {
    const dirName = slugify(skill.name);
    const filePath = path.join(baseDir, dirName, "SKILL.md");
    const frontmatter: Record<string, unknown> = {
      name: skill.name,
      description: skill.description,
    };
    const content = serializeFrontmatter(frontmatter, skill.body);
    writeIfNotDry(filePath, content, dryRun);
    files.push(filePath);
  }
  return files;
}

/**
 * Import MCP servers from a JSON file with `{ mcpServers: { ... } }` shape.
 * Used by Claude (.mcp.json) and Cursor (.cursor/mcp.json).
 */
export function importMcpFromJson(filePath: string): McpServer[] {
  const json = readJsonAs(filePath, isObjectWithMcpServers);
  if (!json?.mcpServers) return [];

  return Object.entries(json.mcpServers).map(([name, cfg]) => ({
    name,
    type: getString(cfg, "type") === "http" ? "http" : "stdio",
    command: getString(cfg, "command"),
    args: getStringArray(cfg, "args"),
    url: getString(cfg, "url"),
    env: getStringRecord(cfg, "env"),
    headers: getStringRecord(cfg, "headers"),
  }));
}

function isObjectWithMcpServers(
  v: unknown,
): v is { mcpServers?: Record<string, Record<string, unknown>> } {
  return typeof v === "object" && v !== null;
}

/**
 * Export MCP servers to a JSON file with `{ mcpServers: { ... } }` shape.
 */
export function exportMcpToJson(
  filePath: string,
  servers: McpServer[],
  dryRun: boolean,
): string[] {
  if (servers.length === 0) return [];
  const mcpJson: Record<string, Record<string, unknown>> = {};
  for (const server of servers) {
    const entry: Record<string, unknown> = {};
    if (server.type !== "stdio") entry.type = server.type;
    if (server.command) entry.command = server.command;
    if (server.args) entry.args = server.args;
    if (server.url) entry.url = server.url;
    if (server.env) entry.env = server.env;
    if (server.headers) entry.headers = server.headers;
    mcpJson[server.name] = entry;
  }
  writeIfNotDry(filePath, `${JSON.stringify({ mcpServers: mcpJson }, null, 2)}\n`, dryRun);
  return [filePath];
}

/**
 * Convert env var syntax: `${VAR}` <-> `{env:VAR}`.
 */
export function envVarsToOpenCode(
  vars: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(vars).map(([k, v]) => [k, v.replaceAll(/\$\{(\w+)\}/g, "{env:$1}")]),
  );
}

export function envVarsFromOpenCode(
  vars: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(vars).map(([k, v]) => [k, v.replaceAll(/\{env:(\w+)\}/g, "${$1}")]),
  );
}


/**
 * Export rules to a single file by concatenating with `---` separator.
 * Used by converters that write rules to one file (opencode→AGENTS.md, codex→AGENTS.md, claude→CLAUDE.md).
 */
export function exportRulesToFile(
  filePath: string,
  rules: HarnessConfig["rules"],
  dryRun: boolean,
): string[] {
  if (rules.length === 0) return [];
  const combined = rules.map((r) => r.content).join("\n\n---\n\n");
  writeIfNotDry(filePath, combined, dryRun);
  return [filePath];
}

/**
 * Generate standard "dropped" warnings for features not supported by a target.
 * Eliminates duplicate warning blocks across cursor, windsurf, copilot, codex exporters.
 */
export function generateDropWarnings(
  config: HarnessConfig,
  unsupported: {
    agents?: string;
    skills?: string;
    commands?: string;
    mcpServers?: string;
    permissions?: string;
    hooksFormatters?: string;
  },
): string[] {
  const warnings: string[] = [];
  if (unsupported.agents && config.agents.length > 0) {
    warnings.push(`${config.agents.length} agent(s) ${unsupported.agents}`);
  }
  if (unsupported.skills && config.skills.length > 0) {
    warnings.push(`${config.skills.length} skill(s) ${unsupported.skills}`);
  }
  if (unsupported.commands && config.commands.length > 0) {
    warnings.push(`${config.commands.length} command(s) ${unsupported.commands}`);
  }
  if (unsupported.mcpServers && config.mcpServers.length > 0) {
    warnings.push(`${config.mcpServers.length} MCP server(s) ${unsupported.mcpServers}`);
  }
  if (unsupported.permissions && config.permissions.length > 0) {
    warnings.push(unsupported.permissions);
  }
  if (unsupported.hooksFormatters && (config.hooks.length > 0 || config.formatters.length > 0)) {
    warnings.push(unsupported.hooksFormatters);
  }
  return warnings;
}

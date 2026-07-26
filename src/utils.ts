import * as YAML from "yaml";
import * as path from "node:path";
import * as fs from "node:fs";
import type {
  FidelityItem,
  HarnessConfig,
  McpServer,
  PermissionEntry,
  Skill,
} from "./schema.js";
import type { PermissionAction } from "./converters/types.js";


export interface FrontmatterResult {
  data: Record<string, unknown>;
  content: string;
}

/**
 * Leading YAML frontmatter: optional BOM, `---`, block, closing `---`.
 * Tolerates CRLF and an empty block (`---\n---`).
 */
const FRONTMATTER = /^﻿?---[ \t]*\r?\n([\s\S]*?)(?:\r?\n)?---[ \t]*(?:\r?\n|$)/;

export function parseFrontmatter(raw: string): FrontmatterResult {
  const match = FRONTMATTER.exec(raw);
  if (!match) return { data: {}, content: raw.trim() };

  const parsed: unknown = YAML.parse(match[1]);
  const data =
    parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};

  return { data, content: raw.slice(match[0].length).trim() };
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
  // singleQuote matches the style already on disk in files written by earlier versions.
  const yaml = YAML.stringify(clean, { singleQuote: true });
  return `---\n${yaml}---\n${body.replace(/\n+$/, "")}\n`;
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


function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "ENOENT"
  );
}

/**
 * Problems encountered while reading source config, collected during import.
 *
 * A file that is absent is not a problem — most configs use a fraction of the possible paths.
 * A file that exists but cannot be read or parsed is, and must not be reported as "no config
 * found", which is what swallowing every error used to do.
 */
// ponytail: module-level collector, drained once per `import()`. Safe for the CLI, where one
// import runs synchronously to completion. Two imports interleaved in the same process would
// mix their problems. Thread a context through the ~40 read call sites if this is ever used
// concurrently as a library. Writes thread a real context (WriteContext) because there are
// only 22 sites and a lost write is worse than a misattributed warning.
const readProblems: FidelityItem[] = [];

/** Take and clear the problems collected since the last call. Called once per import. */
export function takeReadProblems(): FidelityItem[] {
  return readProblems.splice(0, readProblems.length);
}

function recordReadProblem(filePath: string, reason: string): void {
  readProblems.push({
    phase: "import",
    kind: "rule",
    name: filePath,
    status: "blocked",
    reason,
  });
}

export function readFileIfExists(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch (err) {
    // Absent is normal. Anything else — permissions, a directory in the way — is not, and
    // silently returning undefined made it indistinguishable from "no config here".
    if (!isNotFound(err)) {
      recordReadProblem(
        filePath,
        `could not be read: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return undefined;
  }
}

export function readJsonIfExists(filePath: string): unknown {
  const raw = readFileIfExists(filePath);
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch (err) {
    recordReadProblem(
      filePath,
      `is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
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
 * Carries write policy and collects what happened. Replaces the bare `dryRun` boolean that
 * used to be threaded to every write site.
 */
export interface WriteContext {
  dryRun: boolean;
  force: boolean;
  items: FidelityItem[];
}

export function newWriteContext(
  options: { dryRun?: boolean; force?: boolean } = {},
): WriteContext {
  return {
    dryRun: options.dryRun ?? false,
    force: options.force ?? false,
    items: [],
  };
}

/**
 * Write a file, refusing to destroy anything already there.
 *
 * This is the only place in `src/` that calls `fs.writeFileSync`, so the never-clobber rule
 * has a single enforcement point that no converter can bypass.
 *
 * - absent  → write
 * - same    → no-op, still counts as written (the target state is already achieved, so a
 *             re-run of the same conversion is idempotent rather than a wall of conflicts)
 * - differs → refuse and report `blocked`, unless `force`, which backs up to `<path>.bak` first
 *
 * Returns whether the path should be counted as written.
 */
export function writeIfNotDry(
  filePath: string,
  content: string,
  ctx: WriteContext,
): boolean {
  const existing = fs.existsSync(filePath)
    ? fs.readFileSync(filePath, "utf-8")
    : undefined;

  if (existing === content) return true; // already correct; do not rewrite

  if (existing !== undefined && !ctx.force) {
    ctx.items.push({
      phase: "export",
      kind: "rule",
      name: filePath,
      status: "blocked",
      reason:
        "a different file already exists at this path; refusing to overwrite it. Re-run with --force to replace it, keeping a .bak copy",
    });
    return false;
  }

  if (existing !== undefined) {
    // force: the original is destroyed unless it is preserved first.
    const backup = `${filePath}.bak`;
    if (!ctx.dryRun) fs.copyFileSync(filePath, backup);
    ctx.items.push({
      phase: "export",
      kind: "rule",
      name: backup,
      status: "lossy",
      reason: `overwrote an existing file; the previous content was saved to ${backup}`,
    });
  }

  if (!ctx.dryRun) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, content);
  }
  return true;
}

/**
 * One distinct slug per input, preserving order.
 *
 * `slugify` is lossy — `Testing`, `testing`, and `code review` vs `code-review` all collapse —
 * and every caller used the result as a filename, so the second write silently destroyed the
 * first. Collisions get a numeric suffix instead.
 */
export function uniqueSlugs(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const base = slugify(name);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count + 1}`;
  });
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
  ctx: WriteContext,
): string[] {
  const files: string[] = [];
  const dirNames = uniqueSlugs(skills.map((s) => s.name));

  skills.forEach((skill, i) => {
    const dirName = dirNames[i];
    if (dirName !== slugify(skill.name)) {
      ctx.items.push({
        phase: "export",
        kind: "skill",
        name: skill.name,
        status: "lossy",
        reason: `another skill already claimed the directory "${slugify(skill.name)}"; written to "${dirName}" instead`,
      });
    }
    const filePath = path.join(baseDir, dirName, "SKILL.md");
    const frontmatter: Record<string, unknown> = {
      name: skill.name,
      description: skill.description,
    };
    const content = serializeFrontmatter(frontmatter, skill.body);
    if (writeIfNotDry(filePath, content, ctx)) files.push(filePath);
  });
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
  ctx: WriteContext,
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
  if (!writeIfNotDry(filePath, `${JSON.stringify({ mcpServers: mcpJson }, null, 2)}\n`, ctx)) return [];
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
  ctx: WriteContext,
): string[] {
  if (rules.length === 0) return [];
  const combined = rules.map((r) => r.content).join("\n\n---\n\n");
  if (!writeIfNotDry(filePath, combined, ctx)) return [];
  return [filePath];
}

/**
 * Decide what happens to one outgoing permission, given what the target can express.
 *
 * This is the single place the never-weaken rule is enforced. A `deny` or `ask` that the
 * target cannot represent is BLOCKED — never rewritten as an `allow`, and never emitted in
 * any weakened form. There is deliberately no flag that downgrades it; the blocked item
 * names the permission so it can be carried across by hand.
 *
 * An `allow` the target cannot represent is merely `lossy`: dropping a permission the user
 * already granted cannot widen their posture.
 */
export function permissionStatus(
  entry: PermissionEntry,
  targetActions: ReadonlySet<PermissionAction>,
  targetName: string,
): FidelityItem {
  const name = `${entry.tool}(${entry.pattern})`;
  if (targetActions.has(entry.action)) {
    return { phase: "export", kind: "permission", name, status: "exact" };
  }
  // Dropping an allow cannot widen a posture, so it is ordinary loss. Dropping a deny or ask
  // would, so it is refused and fails the run.
  const status = entry.action === "allow" ? "dropped" : "blocked";
  const reason =
    status === "blocked"
      ? `${targetName} cannot express a "${entry.action}" permission; refusing to emit it as an allow`
      : `${targetName} has no project-level permission config, so this allow rule was dropped`;
  return { phase: "export", kind: "permission", name, status, reason };
}

/**
 * Standard items for features a target cannot represent.
 * Shared by the cursor, windsurf, copilot, and codex exporters.
 *
 * Permissions are handled separately by `permissionStatus`, because they are the one kind
 * whose loss can weaken a security posture.
 */
export function generateDropItems(
  config: HarnessConfig,
  unsupported: {
    agents?: string;
    skills?: string;
    commands?: string;
    mcpServers?: string;
    hooksFormatters?: string;
  },
): FidelityItem[] {
  const items: FidelityItem[] = [];
  const drop = (
    kind: FidelityItem["kind"],
    names: string[],
    reason: string,
    status: FidelityItem["status"] = "dropped",
  ) => {
    for (const name of names) {
      items.push({ phase: "export", kind, name, status, reason });
    }
  };

  if (unsupported.agents && config.agents.length > 0) {
    drop("agent", config.agents.map((a) => a.name), unsupported.agents);
  }
  if (unsupported.skills && config.skills.length > 0) {
    drop("skill", config.skills.map((s) => s.name), unsupported.skills);
  }
  if (unsupported.commands && config.commands.length > 0) {
    drop("command", config.commands.map((c) => c.name), unsupported.commands);
  }
  if (unsupported.mcpServers && config.mcpServers.length > 0) {
    drop("mcp", config.mcpServers.map((s) => s.name), unsupported.mcpServers);
  }
  if (unsupported.hooksFormatters) {
    drop("hook", config.hooks.map((h) => h.event), unsupported.hooksFormatters);
    drop("formatter", config.formatters.map((f) => f.glob), unsupported.hooksFormatters);
  }
  return items;
}

/** Mark a list of names as fully converted. */
export function exactItems(
  kind: FidelityItem["kind"],
  names: string[],
): FidelityItem[] {
  return names.map((name) => ({
    phase: "export" as const,
    kind,
    name,
    status: "exact" as const,
  }));
}

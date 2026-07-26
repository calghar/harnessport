import * as path from "node:path";
import * as fs from "node:fs";
import type { Converter, ExportOptions, ExportResult } from "./types.js";
import { ALL_ACTIONS } from "./types.js";
import type {
  HarnessConfig,
  Agent,
  Command,
  FidelityItem,
  McpServer,
  PermissionAction,
  PermissionEntry,
  Formatter,
} from "../schema.js";
import type { WriteContext } from "../utils.js";
import {
  parseFrontmatter,
  serializeFrontmatter,
  readFileIfExists,
  readJsonAs,
  listMdFiles,
  getString,
  getNumber,
  getRecord,
  getStringArray,
  getStringRecord,
  importSkillsFromDir,
  exportSkillsToDir,
  exportRulesToFile,
  writeIfNotDry,
  uniqueSlugs,
  takeReadProblems,
  newWriteContext,
  slugify,
  envVarsToOpenCode,
  envVarsFromOpenCode,
  exactItems,
  permissionStatus,
} from "../utils.js";

// --- Shared constants ---

/**
 * Permission keys that accept granular object syntax (pattern → action).
 * All others are shorthand-only ("allow" | "ask" | "deny").
 * @see https://opencode.ai/docs/permissions/
 */
const GRANULAR_PERMISSIONS = new Set([
  "read", "edit", "glob", "grep", "list", "bash", "task",
  "external_directory", "lsp", "skill",
]);

/**
 * OpenCode permission keys, mapped to the canonical tool names the schema uses.
 *
 * `PermissionEntry.tool` is canonically the capitalised name Claude Code matches. Importing
 * OpenCode's lowercase keys verbatim wrote `bash(git push *)` into `.claude/settings.local.json`,
 * where Claude Code matches `Bash` — so an "ask" rule never fired and the command ran unprompted.
 * A key with no canonical equivalent keeps its own name rather than being guessed at.
 */
const CANONICAL_TOOLS: Record<string, string> = {
  bash: "Bash",
  read: "Read",
  edit: "Edit",
  write: "Write",
  glob: "Glob",
  grep: "Grep",
  task: "Task",
  webfetch: "WebFetch",
  websearch: "WebSearch",
};

function canonicalTool(key: string): string {
  return CANONICAL_TOOLS[key.toLowerCase()] ?? key;
}

/**
 * Tools OpenCode has no permission key for. `buildPermissionConfig` drops these, so reporting
 * them `exact` claimed a conversion that never happened.
 */
const UNREPRESENTABLE_TOOLS = new Set(["websearch"]);

// --- Import ---

function importRules(rootDir: string): HarnessConfig["rules"] {
  const agentsMd = readFileIfExists(path.join(rootDir, "AGENTS.md"));
  if (!agentsMd) return [];
  return [{ content: agentsMd, source: "AGENTS.md" }];
}

function importAgents(rootDir: string): Agent[] {
  const agentsDir = path.join(rootDir, ".opencode", "agents");
  return listMdFiles(agentsDir).map((filePath) => {
    const raw = fs.readFileSync(filePath, "utf-8");
    const { data, content } = parseFrontmatter(raw);
    const perm = getRecord(data, "permission");
    const tools = perm
      ? Object.keys(perm).filter((k) => k !== "edit")
      : undefined;
    const rawMode = getString(data, "mode");
    const mode = rawMode === "primary" || rawMode === "subagent" ? rawMode : undefined;

    return {
      name: path.basename(filePath, ".md"),
      description: getString(data, "description"),
      model: getString(data, "model"),
      body: content,
      mode,
      temperature: getNumber(data, "temperature"),
      permissions: perm as Record<string, string | Record<string, string>> | undefined,
      tools,
    };
  });
}

function importCommands(rootDir: string): Command[] {
  const commandsDir = path.join(rootDir, ".opencode", "commands");
  return listMdFiles(commandsDir).map((filePath) => {
    const raw = fs.readFileSync(filePath, "utf-8");
    const { data, content } = parseFrontmatter(raw);
    return {
      name: path.basename(filePath, ".md"),
      description: getString(data, "description"),
      body: content,
      agent: getString(data, "agent"),
    };
  });
}

type OpenCodeConfigJson = {
  mcp?: Record<string, Record<string, unknown>>;
  permission?: Record<string, Record<string, string> | string>;
  formatter?: Record<string, unknown> | false;
};

function isOpenCodeConfigJson(v: unknown): v is OpenCodeConfigJson {
  return typeof v === "object" && v !== null;
}

function toAction(value: string): PermissionEntry["action"] {
  return value === "deny" || value === "ask" ? value : "allow";
}

/**
 * OpenCode expresses a permission as either a shorthand action ("bash": "deny") or a
 * per-pattern map ("bash": { "rm *": "deny" }). Both carry the action; reading only the
 * keys discarded it and every rule became an allow downstream.
 */
function parsePermissions(
  permConfig: Record<string, Record<string, string> | string>,
): PermissionEntry[] {
  return Object.entries(permConfig).flatMap(([key, rules]) => {
    const tool = canonicalTool(key);
    if (typeof rules === "string") {
      return [{ tool, pattern: "*", action: toAction(rules) }];
    }
    return Object.entries(rules).map(([pattern, action]) => ({
      tool,
      pattern,
      action: toAction(action),
    }));
  });
}

function parseFormatters(
  fmtConfig: Record<string, unknown>,
): Formatter[] {
  return Object.entries(fmtConfig).flatMap(([name, cfg]) => {
    if (typeof cfg === "object" && cfg !== null && !Array.isArray(cfg)) {
      const obj = cfg as Record<string, unknown>;
      const command = getStringArray(obj, "command")?.join(" ").replace("$FILE", "").trim();
      const extensions = getStringArray(obj, "extensions") ?? [];
      const glob = extensions.length > 0
        ? (extensions.length === 1 ? `*${extensions[0]}` : `*.{${extensions.map((e) => e.slice(1)).join(",")}}`)
        : "*";
      return command ? [{ glob, command }] : [];
    }
    // Legacy format: { "*.py": "command" }
    if (typeof cfg === "string") {
      return [{ glob: name, command: cfg }];
    }
    return [];
  });
}

function importMcpAndConfig(rootDir: string): {
  mcpServers: McpServer[];
  permissions: PermissionEntry[];
  formatters: Formatter[];
} {
  const configJson = readJsonAs(
    path.join(rootDir, "opencode.json"),
    isOpenCodeConfigJson,
  );

  if (!configJson) {
    return { mcpServers: [], permissions: [], formatters: [] };
  }

  const mcpServers: McpServer[] = configJson.mcp
    ? Object.entries(configJson.mcp).map(([name, cfg]) => parseOpenCodeMcpEntry(name, cfg))
    : [];

  const permissions = configJson.permission
    ? parsePermissions(configJson.permission)
    : [];

  const formatters = (configJson.formatter && typeof configJson.formatter === "object")
    ? parseFormatters(configJson.formatter)
    : [];

  return { mcpServers, permissions, formatters };
}

function parseOpenCodeMcpEntry(
  name: string,
  cfg: Record<string, unknown>,
): McpServer {
  const cmdArray = getStringArray(cfg, "command");
  const server: McpServer = {
    name,
    type: cfg.type === "remote" ? "http" : "stdio",
    enabled: typeof cfg.enabled === "boolean" ? cfg.enabled : undefined,
  };
  if (cmdArray && cmdArray.length > 0) {
    server.command = cmdArray[0];
    server.args = cmdArray.slice(1);
  }
  const url = getString(cfg, "url");
  if (url) server.url = url;
  const env = getStringRecord(cfg, "environment");
  if (env) {
    server.env = envVarsFromOpenCode(env);
  }
  const headers = getStringRecord(cfg, "headers");
  if (headers) {
    server.headers = envVarsFromOpenCode(headers);
  }
  return server;
}

// --- Export ---

function buildAgentPermission(agent: Agent): Record<string, unknown> {
  const TOOL_PERMISSION_MAP: Record<string, [string, unknown]> = {
    bash: ["bash", { "*": "ask" }],
    write: ["edit", "allow"],
    edit: ["edit", "allow"],
    multiedit: ["edit", "allow"],
    websearch: ["websearch", "allow"],
    webfetch: ["webfetch", "allow"],
  };

  const permission: Record<string, unknown> = {};

  if (agent.tools) {
    for (const tool of agent.tools) {
      const mapped = TOOL_PERMISSION_MAP[tool.toLowerCase()];
      if (mapped) permission[mapped[0]] = mapped[1];
    }
  }

  if (agent.skills && agent.skills.length > 0) {
    permission.skill = Object.fromEntries([
      ["*", "deny"],
      ...agent.skills.map((s) => [s, "allow"]),
    ]);
  }

  if (agent.permissions) {
    for (const [key, val] of Object.entries(agent.permissions)) {
      if (typeof val === "string") {
        permission[key] = val;
      } else if (typeof val === "object" && val !== null && GRANULAR_PERMISSIONS.has(key)) {
        permission[key] = val;
      } else if (typeof val === "object" && val !== null) {
        // Shorthand-only keys: flatten to most permissive value
        const values = Object.values(val);
        permission[key] = values.includes("allow") ? "allow" : "ask";
      }
    }
  }

  return permission;
}

function exportAgents(
  rootDir: string,
  config: HarnessConfig,
  ctx: WriteContext,
): string[] {
  const files: string[] = [];
  for (const agent of config.agents) {
    const fileName = `${slugify(agent.name)}.md`;
    const filePath = path.join(rootDir, ".opencode", "agents", fileName);

    const permission = buildAgentPermission(agent);
    const frontmatter: Record<string, unknown> = {
      description: agent.description,
      mode: agent.mode ?? "subagent",
      model: agent.model,
      temperature: agent.temperature,
      permission: Object.keys(permission).length > 0 ? permission : undefined,
    };

    const content = serializeFrontmatter(frontmatter, agent.body);
    if (writeIfNotDry(filePath, content, ctx)) files.push(filePath);
  }
  return files;
}

function exportCommands(
  rootDir: string,
  config: HarnessConfig,
  ctx: WriteContext,
): string[] {
  const files: string[] = [];
  for (const cmd of config.commands) {
    const fileName = `${slugify(cmd.name)}.md`;
    const filePath = path.join(rootDir, ".opencode", "commands", fileName);
    const frontmatter: Record<string, unknown> = {
      description: cmd.description,
      agent: cmd.agent,
    };
    let body = cmd.body;
    if (cmd.allowedTools && cmd.allowedTools.length > 0) {
      body = `<!-- Original allowed-tools: ${cmd.allowedTools.join(", ")} -->\n\n${body}`;
    }
    const content = serializeFrontmatter(frontmatter, body);
    if (writeIfNotDry(filePath, content, ctx)) files.push(filePath);
  }
  return files;
}

/**
 * Name a formatter after the tool it actually runs.
 *
 * This previously mapped black/isort/autopep8/yapf all onto the literal name "ruff", so a
 * project using two of them emitted one entry — the other was silently lost to
 * `Object.fromEntries` — and the surviving key named a tool the command did not invoke.
 */
const KNOWN_FORMATTERS = [
  "ruff", "black", "isort", "autopep8", "yapf",
  "prettier", "eslint", "gofmt", "goimports",
  "rustfmt", "biome", "shfmt",
];

function inferFormatterName(command: string): string {
  const match = KNOWN_FORMATTERS.find((tool) => command.includes(tool));
  return match ?? slugify(command.split(/\s+/)[0]);
}

/** Convert glob pattern to file extensions array. */
function globToExtensions(glob: string): string[] {
  const singleMatch = glob.match(/^\*\.(\w+)$/);
  if (singleMatch) return [`.${singleMatch[1]}`];
  const multiMatch = glob.match(/^\*\.\{(.+)\}$/);
  if (multiMatch) return multiMatch[1].split(",").map((ext) => `.${ext.trim()}`);
  return [];
}

function buildFormatterConfig(
  formatters: Formatter[],
): Record<string, Record<string, unknown>> {
  // uniqueSlugs keeps two formatters from collapsing onto one key.
  const names = uniqueSlugs(formatters.map((f) => inferFormatterName(f.command)));
  return Object.fromEntries(
    formatters.map((f, i) => {
      const parts = f.command.split(/\s+/);
      return [names[i], {
        command: [...parts, "$FILE"],
        extensions: globToExtensions(f.glob),
      }];
    }),
  );
}

function exportOpenCodeJson(
  rootDir: string,
  config: HarnessConfig,
  ctx: WriteContext,
  writablePermissions: PermissionEntry[],
): string[] {
  const openCodeConfig: Record<string, unknown> = {
    $schema: "https://opencode.ai/config.json",
    instructions: ["AGENTS.md"],
    ...(config.mcpServers.length > 0 && { mcp: buildMcpConfig(config.mcpServers) }),
    ...(writablePermissions.length > 0 && {
      permission: buildPermissionConfig(writablePermissions),
    }),
    ...(config.formatters.length > 0 && {
      formatter: buildFormatterConfig(config.formatters),
    }),
  };

  // Remove empty permission object if it got through
  if (openCodeConfig.permission && Object.keys(openCodeConfig.permission as object).length === 0) {
    delete openCodeConfig.permission;
  }

  const filePath = path.join(rootDir, "opencode.json");
  if (!writeIfNotDry(filePath, `${JSON.stringify(openCodeConfig, null, 2)}\n`, ctx)) {
    return [];
  }
  return [filePath];
}

function buildMcpEntry(server: McpServer): Record<string, unknown> {
  const entry: Record<string, unknown> = {};
  if (server.type === "http") {
    entry.type = "remote";
    if (server.url) entry.url = server.url;
    if (server.headers) entry.headers = envVarsToOpenCode(server.headers);
  } else {
    entry.type = "local";
    const cmd = buildCommandArray(server);
    if (cmd.length > 0) entry.command = cmd;
  }
  if (server.env) entry.environment = envVarsToOpenCode(server.env);
  entry.enabled = server.enabled ?? true;
  return entry;
}

function buildCommandArray(server: McpServer): string[] {
  const cmd: string[] = [];
  if (server.command) cmd.push(server.command);
  if (server.args) cmd.push(...server.args);
  return cmd;
}

function buildMcpConfig(
  servers: McpServer[],
): Record<string, Record<string, unknown>> {
  return Object.fromEntries(servers.map((s) => [s.name, buildMcpEntry(s)]));
}

function transformPermissionPattern(pattern: string): string {
  return pattern.startsWith("domain:") ? `https://${pattern.slice(7)}/*` : pattern;
}

/**
 * A shorthand-only tool takes one action for every pattern. Collapsing a set that contains a
 * deny or ask would widen it, so those entries are refused instead — see `partitionPermissions`.
 */
function isShorthandOnly(entry: PermissionEntry): boolean {
  return !GRANULAR_PERMISSIONS.has(entry.tool.toLowerCase());
}

/** Permission actions OpenCode can express for a tool it has no key for: none. */
const NO_ACTIONS: ReadonlySet<PermissionAction> = new Set();

/**
 * Split outgoing permissions into those OpenCode can express and those it cannot.
 *
 * Blocked: a deny/ask on a shorthand-only tool, where the only representable form is a
 * single action covering every pattern — writing it would grant more than the source did.
 *
 * A tool OpenCode has no key for at all goes through `permissionStatus`, the single place the
 * never-weaken rule lives, rather than getting a second decision site here.
 */
function partitionPermissions(permissions: PermissionEntry[]): {
  writable: PermissionEntry[];
  items: FidelityItem[];
} {
  const writable: PermissionEntry[] = [];
  const items: FidelityItem[] = [];

  for (const p of permissions) {
    const name = `${p.tool}(${p.pattern})`;
    if (UNREPRESENTABLE_TOOLS.has(p.tool.toLowerCase())) {
      // OpenCode does have project-level permissions; it simply has no key for this tool.
      items.push(
        permissionStatus(p, NO_ACTIONS, "OpenCode", `has no "${p.tool}" permission key`),
      );
      continue;
    }
    if (p.action !== "allow" && isShorthandOnly(p)) {
      items.push({
        phase: "export",
        kind: "permission",
        name,
        status: "blocked",
        reason: `OpenCode expresses "${p.tool}" only as a single shorthand action, so this "${p.action}" rule cannot be written without widening it`,
      });
      continue;
    }
    writable.push(p);
    items.push({
      phase: "export",
      kind: "permission",
      name,
      status: isShorthandOnly(p) && p.pattern !== "*" ? "lossy" : "exact",
      ...(isShorthandOnly(p) &&
        p.pattern !== "*" && {
          reason: `OpenCode has no granular patterns for "${p.tool}"; the pattern was flattened to a shorthand "${p.action}"`,
        }),
    });
  }

  return { writable, items };
}

/**
 * Build the global permission config for opencode.json from entries already cleared for writing.
 * `partitionPermissions` has already removed the tools OpenCode has no key for.
 */
function buildPermissionConfig(
  permissions: PermissionEntry[],
): Record<string, Record<string, string> | string> {
  const grouped = permissions
    .reduce<Record<string, Array<{ pattern: string; action: string }>>>((acc, p) => {
      const toolKey = p.tool.toLowerCase();
      if (!acc[toolKey]) acc[toolKey] = [];
      acc[toolKey].push({
        pattern: transformPermissionPattern(p.pattern),
        action: p.action,
      });
      return acc;
    }, {});

  return Object.fromEntries(
    Object.entries(grouped).map(([tool, rules]) => {
      if (GRANULAR_PERMISSIONS.has(tool)) {
        return [tool, Object.fromEntries(rules.map((r) => [r.pattern, r.action]))];
      }
      // Shorthand-only: only allow entries reach here, so collapsing cannot widen.
      return [tool, "allow"];
    }),
  );
}

// --- Converter ---

export const opencodeConverter: Converter = {
  name: "opencode",
  label: "OpenCode",
  // OpenCode's only tool-event mechanism is the formatter, which is a separate feature here. It
  // has no general hook config, so a Hook has nowhere to go.
  capabilities: {
    rule: "full",
    agent: "full",
    skill: "full",
    command: "full",
    mcp: "full",
    permission: "full",
    hook: "none",
    formatter: "full",
  },
  permissionActions: ALL_ACTIONS,

  detect(rootDir: string): boolean {
    return (
      fs.existsSync(path.join(rootDir, "AGENTS.md")) ||
      fs.existsSync(path.join(rootDir, ".opencode")) ||
      fs.existsSync(path.join(rootDir, "opencode.json"))
    );
  },

  import(rootDir: string): HarnessConfig {
    const { mcpServers, permissions, formatters } = importMcpAndConfig(rootDir);

    return {
      rules: importRules(rootDir),
      agents: importAgents(rootDir),
      skills: importSkillsFromDir(
        path.join(rootDir, ".opencode", "skills"),
        { nested: true, flatMd: true },
      ),
      commands: importCommands(rootDir),
      mcpServers,
      permissions,
      hooks: [],
      formatters,
      items: takeReadProblems(),
    };
  },

  export(
    rootDir: string,
    config: HarnessConfig,
    options: ExportOptions = {},
  ): ExportResult {
    const ctx = newWriteContext(options);
    const items: FidelityItem[] = [...config.items];
    const { writable, items: permissionItems } = partitionPermissions(config.permissions);

    const filesWritten: string[] = [
      ...exportRulesToFile(
        path.join(rootDir, "AGENTS.md"),
        config.rules,
        ctx,
      ),
      ...exportAgents(rootDir, config, ctx),
      ...exportSkillsToDir(
        path.join(rootDir, ".opencode", "skills"),
        config.skills,
        ctx,
      ),
      ...exportCommands(rootDir, config, ctx),
      ...exportOpenCodeJson(rootDir, config, ctx, writable),
    ];

    items.push(
      ...permissionItems,
      ...exactItems("rule", config.rules.map((r) => r.source ?? "project-rules")),
      ...exactItems("skill", config.skills.map((s) => s.name)),
      ...exactItems("mcp", config.mcpServers.map((s) => s.name)),
      ...exactItems("formatter", config.formatters.map((f) => f.glob)),
    );

    for (const hook of config.hooks) {
      items.push({
        phase: "export",
        kind: "hook",
        name: hook.event,
        // Nothing is written for a hook, so this is `dropped`, not `lossy`. `lossy` means the
        // content reached the target with a field removed; the distinction is what lets a reader
        // tell "in the file, minus a detail" from "not in the file at all".
        status: "dropped",
        reason:
          "OpenCode supports only formatters (PostToolUse on Edit/Write); this hook was dropped",
      });
    }

    for (const cmd of config.commands) {
      const lostTools = cmd.allowedTools && cmd.allowedTools.length > 0;
      items.push({
        phase: "export",
        kind: "command",
        name: cmd.name,
        status: lostTools ? "lossy" : "exact",
        ...(lostTools && {
          reason:
            "OpenCode commands have no allowed-tools field; the original list was kept as an HTML comment",
        }),
      });
    }

    for (const agent of config.agents) {
      const remapped = agent.skills && agent.skills.length > 0;
      items.push({
        phase: "export",
        kind: "agent",
        name: agent.name,
        status: remapped ? "lossy" : "exact",
        ...(remapped && {
          reason:
            'agent "skills" were remapped onto OpenCode permission.skill patterns (deny-by-default, listed skills allowed)',
        }),
      });
    }

    items.push(...ctx.items);
    return { filesWritten, items };
  },
};

import * as path from "node:path";
import * as fs from "node:fs";
import type { Converter, ExportResult } from "./types.js";
import type {
  HarnessConfig,
  Agent,
  Command,
  McpServer,
  PermissionEntry,
  Formatter,
} from "../schema.js";
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
  slugify,
  envVarsToOpenCode,
  envVarsFromOpenCode,
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

function parsePermissions(
  permConfig: Record<string, Record<string, string> | string>,
): PermissionEntry[] {
  return Object.entries(permConfig).flatMap(([tool, rules]) => {
    if (typeof rules === "string") {
      return [{ tool, pattern: "*" }];
    }
    return Object.keys(rules).map((pattern) => ({ tool, pattern }));
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
  dryRun: boolean,
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
    writeIfNotDry(filePath, content, dryRun);
    files.push(filePath);
  }
  return files;
}

function exportCommands(
  rootDir: string,
  config: HarnessConfig,
  dryRun: boolean,
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
    writeIfNotDry(filePath, content, dryRun);
    files.push(filePath);
  }
  return files;
}

/** Infer a formatter name from the command string. */
function inferFormatterName(command: string): string {
  const COMMAND_NAME_MAP: Record<string, string> = {
    ruff: "ruff", black: "ruff", isort: "ruff", autopep8: "ruff", yapf: "ruff",
    prettier: "prettier", eslint: "prettier",
    gofmt: "gofmt", goimports: "gofmt",
    rustfmt: "rustfmt",
    biome: "biome",
    shfmt: "shfmt",
  };
  const match = Object.entries(COMMAND_NAME_MAP).find(([key]) => command.includes(key));
  return match ? match[1] : slugify(command.split(/\s+/)[0]);
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
  return Object.fromEntries(
    formatters.map((f) => {
      const name = inferFormatterName(f.command);
      const parts = f.command.split(/\s+/);
      return [name, {
        command: [...parts, "$FILE"],
        extensions: globToExtensions(f.glob),
      }];
    }),
  );
}

function exportOpenCodeJson(
  rootDir: string,
  config: HarnessConfig,
  dryRun: boolean,
): string[] {
  const openCodeConfig: Record<string, unknown> = {
    $schema: "https://opencode.ai/config.json",
    instructions: ["AGENTS.md"],
    ...(config.mcpServers.length > 0 && { mcp: buildMcpConfig(config.mcpServers) }),
    ...(config.permissions.length > 0 && {
      permission: buildPermissionConfig(config.permissions),
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
  writeIfNotDry(filePath, `${JSON.stringify(openCodeConfig, null, 2)}\n`, dryRun);
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
 * Build the global permission config for opencode.json.
 * Returns warnings for any shorthand-only tools where URL/pattern specificity was lost.
 */
function buildPermissionConfig(
  permissions: PermissionEntry[],
): Record<string, Record<string, string> | string> {
  const grouped = permissions
    .filter((p) => p.tool.toLowerCase() !== "websearch")
    .reduce<Record<string, Array<{ pattern: string; action: string }>>>((acc, p) => {
      const toolKey = p.tool.toLowerCase();
      if (!acc[toolKey]) acc[toolKey] = [];
      acc[toolKey].push({ pattern: transformPermissionPattern(p.pattern), action: "allow" });
      return acc;
    }, {});

  return Object.fromEntries(
    Object.entries(grouped).map(([tool, rules]) => {
      if (GRANULAR_PERMISSIONS.has(tool)) {
        return [tool, Object.fromEntries(rules.map((r) => [r.pattern, r.action]))];
      }
      // Shorthand-only: collapse all patterns to a single action
      const action = rules.some((r) => r.action === "allow") ? "allow" : "ask";
      return [tool, action];
    }),
  );
}

/**
 * Detect shorthand-only permissions that had specific patterns which were flattened.
 */
function detectFlattenedPermissionWarnings(permissions: PermissionEntry[]): string[] {
  const shorthandWithPatterns = permissions.filter(
    (p) => !GRANULAR_PERMISSIONS.has(p.tool.toLowerCase()) && p.pattern !== "*",
  );

  if (shorthandWithPatterns.length === 0) return [];

  const tools = [...new Set(shorthandWithPatterns.map((p) => p.tool))];
  return [
    `${tools.join(", ")} permission(s) had URL/pattern-specific rules that were flattened to shorthand "allow". OpenCode does not support granular patterns for these tools.`,
  ];
}

// --- Converter ---

export const opencodeConverter: Converter = {
  name: "opencode",

  detect(rootDir: string): boolean {
    return (
      fs.existsSync(path.join(rootDir, "AGENTS.md")) ||
      fs.existsSync(path.join(rootDir, ".opencode")) ||
      fs.existsSync(path.join(rootDir, "opencode.json"))
    );
  },

  import(rootDir: string): HarnessConfig {
    const warnings: string[] = [];
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
      warnings,
    };
  },

  export(
    rootDir: string,
    config: HarnessConfig,
    dryRun = false,
  ): ExportResult {
    const warnings: string[] = [...config.warnings];
    const filesWritten: string[] = [
      ...exportRulesToFile(
        path.join(rootDir, "AGENTS.md"),
        config.rules,
        dryRun,
      ),
      ...exportAgents(rootDir, config, dryRun),
      ...exportSkillsToDir(
        path.join(rootDir, ".opencode", "skills"),
        config.skills,
        dryRun,
      ),
      ...exportCommands(rootDir, config, dryRun),
      ...exportOpenCodeJson(rootDir, config, dryRun),
    ];

    warnings.push(...detectFlattenedPermissionWarnings(config.permissions));

    if (config.hooks.length > 0) {
      warnings.push(
        `${config.hooks.length} hook(s) could not be converted. OpenCode only supports formatters (PostToolUse on Edit/Write). Non-formatter hooks were dropped.`,
      );
    }
    if (config.agents.some((a) => a.skills && a.skills.length > 0)) {
      warnings.push(
        'Claude agent "skills" references were converted to OpenCode permission.skill patterns (deny-by-default, allow listed skills).',
      );
    }

    return { filesWritten, warnings };
  },
};

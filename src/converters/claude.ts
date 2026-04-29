import * as path from "node:path";
import * as fs from "node:fs";
import type { Converter, ExportResult } from "./types.js";
import type {
  HarnessConfig,
  Agent,
  Command,
  McpServer,
  PermissionEntry,
  Hook,
  Formatter,
} from "../schema.js";
import {
  parseFrontmatter,
  serializeFrontmatter,
  readFileIfExists,
  readJsonAs,
  listMdFiles,
  getString,
  getStringOrFallback,
  getStringArray,
  importSkillsFromDir,
  exportSkillsToDir,
  importMcpFromJson,
  exportMcpToJson,
  exportRulesToFile,
  writeIfNotDry,
  slugify,
} from "../utils.js";

// --- Permission pattern regex (compiled once, reused) ---
const PERMISSION_PATTERN = /^(\w+)(?:\((.+)\))?$/;

// --- Import ---

function importRules(rootDir: string): HarnessConfig["rules"] {
  const claudeMd = readFileIfExists(
    path.join(rootDir, ".claude", "CLAUDE.md"),
  );
  if (!claudeMd) return [];
  return [{ content: claudeMd, source: "CLAUDE.md" }];
}

function parseAgentTools(data: Record<string, unknown>): string[] | undefined {
  const tools = data.tools;
  if (!tools) return undefined;
  if (Array.isArray(tools)) return tools.filter((t): t is string => typeof t === "string");
  if (typeof tools === "string") return tools.split(",").map((t) => t.trim());
  return undefined;
}

function importAgents(rootDir: string): Agent[] {
  const agentsDir = path.join(rootDir, ".claude", "agents");
  return listMdFiles(agentsDir).map((filePath) => {
    const raw = fs.readFileSync(filePath, "utf-8");
    const { data, content } = parseFrontmatter(raw);
    return {
      name: getStringOrFallback(data, "name", path.basename(filePath, ".md")),
      description: getString(data, "description"),
      model: getString(data, "model"),
      body: content,
      skills: getStringArray(data, "skills"),
      tools: parseAgentTools(data),
    };
  });
}

function importCommands(rootDir: string): Command[] {
  const commandsDir = path.join(rootDir, ".claude", "commands");
  return listMdFiles(commandsDir).map((filePath) => {
    const raw = fs.readFileSync(filePath, "utf-8");
    const { data, content } = parseFrontmatter(raw);
    const allowedToolsRaw = getString(data, "allowed-tools");
    return {
      name: path.basename(filePath, ".md"),
      description: getString(data, "description"),
      body: content,
      allowedTools: allowedToolsRaw
        ? allowedToolsRaw.split(",").map((t) => t.trim())
        : undefined,
    };
  });
}

function isPermissionsJson(
  v: unknown,
): v is { permissions?: { allow?: string[] } } {
  return typeof v === "object" && v !== null;
}

function importPermissions(rootDir: string): PermissionEntry[] {
  const settings = readJsonAs(
    path.join(rootDir, ".claude", "settings.local.json"),
    isPermissionsJson,
  );
  if (!settings?.permissions?.allow) return [];

  return settings.permissions.allow.map((entry) => {
    const match = PERMISSION_PATTERN.exec(entry);
    if (!match) return { tool: entry, pattern: "*" };
    return {
      tool: match[1],
      pattern: match[2] ?? "*",
    };
  });
}

function isFormatterHook(
  event: string,
  matcher: string | undefined,
  command: string,
): boolean {
  return (
    event === "PostToolUse" &&
    matcher !== undefined &&
    /Edit|Write|MultiEdit/.test(matcher) &&
    /\$FILEPATH/.test(command)
  );
}

function inferGlobFromCommand(cmd: string): string {
  if (/ruff|black|isort|autopep8|yapf/.test(cmd)) return "*.py";
  if (/prettier|eslint/.test(cmd)) return "*.{js,ts,jsx,tsx}";
  if (/gofmt|goimports/.test(cmd)) return "*.go";
  if (/rustfmt/.test(cmd)) return "*.rs";
  return "*";
}

type HooksJson = {
  hooks?: Record<
    string,
    Array<{ hooks: Array<{ type: string; command: string }>; matcher?: string }>
  >;
};

function isHooksJson(v: unknown): v is HooksJson {
  return typeof v === "object" && v !== null;
}

function importHooks(rootDir: string): { hooks: Hook[]; formatters: Formatter[] } {
  const settings = readJsonAs(
    path.join(rootDir, ".claude", "settings.json"),
    isHooksJson,
  );

  if (!settings?.hooks) return { hooks: [], formatters: [] };

  const allHooks = Object.entries(settings.hooks).flatMap(([event, entries]) =>
    entries.flatMap((entry) =>
      entry.hooks.map((hook) => ({ event, matcher: entry.matcher, command: hook.command })),
    ),
  );

  const formatters = allHooks
    .filter((h) => isFormatterHook(h.event, h.matcher, h.command))
    .map((h) => {
      const cmd = h.command.replace(/\s*\$FILEPATH\s*$/, "").trim();
      return { glob: inferGlobFromCommand(cmd), command: cmd };
    });

  const hooks = allHooks
    .filter((h) => !isFormatterHook(h.event, h.matcher, h.command))
    .map((h) => ({ event: h.event, matcher: h.matcher, command: h.command }));

  return { hooks, formatters };
}

function isEnabledServersJson(
  v: unknown,
): v is { enabledMcpjsonServers?: string[] } {
  return typeof v === "object" && v !== null;
}

function importEnabledServers(rootDir: string): string[] {
  const settings = readJsonAs(
    path.join(rootDir, ".claude", "settings.local.json"),
    isEnabledServersJson,
  );
  return settings?.enabledMcpjsonServers ?? [];
}

// --- Export ---

function exportAgents(
  rootDir: string,
  config: HarnessConfig,
  dryRun: boolean,
): string[] {
  const files: string[] = [];
  for (const agent of config.agents) {
    const fileName = `${slugify(agent.name)}.md`;
    const filePath = path.join(rootDir, ".claude", "agents", fileName);
    const frontmatter: Record<string, unknown> = {
      name: agent.name,
      description: agent.description,
      model: agent.model,
      skills: agent.skills,
      tools: agent.tools,
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
    const filePath = path.join(rootDir, ".claude", "commands", fileName);
    const frontmatter: Record<string, unknown> = {
      "allowed-tools": cmd.allowedTools?.join(", "),
      description: cmd.description,
    };
    const content = serializeFrontmatter(frontmatter, cmd.body);
    writeIfNotDry(filePath, content, dryRun);
    files.push(filePath);
  }
  return files;
}

type HookEntry = { hooks: Array<{ type: string; command: string }>; matcher?: string };

function buildHooksJson(
  config: HarnessConfig,
): Record<string, HookEntry[]> {
  const hooksObj: Record<string, HookEntry[]> = {};

  for (const hook of config.hooks) {
    if (!hooksObj[hook.event]) hooksObj[hook.event] = [];
    const entry: HookEntry = {
      hooks: [{ type: "command", command: hook.command }],
    };
    if (hook.matcher) entry.matcher = hook.matcher;
    hooksObj[hook.event].push(entry);
  }

  for (const fmt of config.formatters) {
    if (!hooksObj.PostToolUse) hooksObj.PostToolUse = [];
    hooksObj.PostToolUse.push({
      hooks: [{ type: "command", command: `${fmt.command} $FILEPATH` }],
      matcher: "Edit|Write|MultiEdit",
    });
  }

  return hooksObj;
}

function buildSettingsLocalJson(
  config: HarnessConfig,
): Record<string, unknown> {
  const allow = config.permissions.map((p) =>
    p.pattern === "*" ? p.tool : `${p.tool}(${p.pattern})`,
  );
  const enabled = config.mcpServers
    .filter((s) => s.enabled !== false)
    .map((s) => s.name);

  const settingsLocal: Record<string, unknown> = {};
  if (allow.length > 0) settingsLocal.permissions = { allow };
  if (enabled.length > 0) settingsLocal.enabledMcpjsonServers = enabled;
  return settingsLocal;
}

function exportSettings(
  rootDir: string,
  config: HarnessConfig,
  dryRun: boolean,
): string[] {
  const files: string[] = [];

  if (config.hooks.length > 0 || config.formatters.length > 0) {
    const hooksObj = buildHooksJson(config);
    const filePath = path.join(rootDir, ".claude", "settings.json");
    writeIfNotDry(filePath, `${JSON.stringify({ hooks: hooksObj }, null, 2)}\n`, dryRun);
    files.push(filePath);
  }

  if (config.permissions.length > 0 || config.mcpServers.some((s) => s.enabled)) {
    const settingsLocal = buildSettingsLocalJson(config);
    const filePath = path.join(rootDir, ".claude", "settings.local.json");
    writeIfNotDry(filePath, `${JSON.stringify(settingsLocal, null, 2)}\n`, dryRun);
    files.push(filePath);
  }

  return files;
}


export const claudeConverter: Converter = {
  name: "claude",

  detect(rootDir: string): boolean {
    return (
      fs.existsSync(path.join(rootDir, ".claude", "CLAUDE.md")) ||
      fs.existsSync(path.join(rootDir, ".mcp.json")) ||
      fs.existsSync(path.join(rootDir, ".claude", "settings.json"))
    );
  },

  import(rootDir: string): HarnessConfig {
    const warnings: string[] = [];
    const { hooks, formatters } = importHooks(rootDir);
    const mcpServers: McpServer[] = importMcpFromJson(
      path.join(rootDir, ".mcp.json"),
    );
    const enabledServers = importEnabledServers(rootDir);

    for (const server of mcpServers) {
      server.enabled =
        enabledServers.length === 0 || enabledServers.includes(server.name);
    }

    return {
      rules: importRules(rootDir),
      agents: importAgents(rootDir),
      skills: importSkillsFromDir(
        path.join(rootDir, ".claude", "skills"),
        { nested: true, flatMd: true },
      ),
      commands: importCommands(rootDir),
      mcpServers,
      permissions: importPermissions(rootDir),
      hooks,
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
        path.join(rootDir, ".claude", "CLAUDE.md"),
        config.rules,
        dryRun,
      ),
      ...exportAgents(rootDir, config, dryRun),
      ...exportSkillsToDir(
        path.join(rootDir, ".claude", "skills"),
        config.skills,
        dryRun,
      ),
      ...exportCommands(rootDir, config, dryRun),
      ...exportMcpToJson(
        path.join(rootDir, ".mcp.json"),
        config.mcpServers,
        dryRun,
      ),
      ...exportSettings(rootDir, config, dryRun),
    ];

    if (config.agents.some((a) => a.mode)) {
      warnings.push(
        'Claude Code does not support agent "mode" (primary/subagent). Dropped.',
      );
    }
    if (config.agents.some((a) => a.temperature !== undefined)) {
      warnings.push(
        "Claude Code does not support agent temperature. Dropped.",
      );
    }
    if (config.agents.some((a) => a.permissions)) {
      warnings.push(
        "Claude Code agents don't have per-agent permissions. Use settings.local.json instead.",
      );
    }

    return { filesWritten, warnings };
  },
};

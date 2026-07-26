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
  PermissionEntry,
  Hook,
  Formatter,
} from "../schema.js";
import type { WriteContext } from "../utils.js";
import {
  parseFrontmatter,
  serializeFrontmatter,
  readFileIfExists,
  readJsonAs,
  listMdFiles,
  uniqueSlugs,
  getGlobs,
  listSubdirs,
  getString,
  getStringOrFallback,
  getStringArray,
  importSkillsFromDir,
  exportSkillsToDir,
  importMcpFromJson,
  exportMcpToJson,
  exportRulesToFile,
  writeIfNotDry,
  takeReadProblems,
  newWriteContext,
  slugify,
  exactItems,
  permissionStatus,
} from "../utils.js";

// --- Permission pattern regex (compiled once, reused) ---
const PERMISSION_PATTERN = /^(\w+)(?:\((.+)\))?$/;

// --- Import ---

/**
 * Instruction files Claude Code loads unconditionally, in load order.
 * Both `./CLAUDE.md` and `./.claude/CLAUDE.md` are valid project locations and both load;
 * reading only the latter made the more common root layout invisible.
 */
const INSTRUCTION_FILES = [
  ["CLAUDE.md"],
  [".claude", "CLAUDE.md"],
  ["CLAUDE.local.md"],
] as const;

/** Every `.md` under a directory, recursively. `.claude/rules/` supports nested folders. */
function listMdFilesRecursive(dirPath: string): string[] {
  return [
    ...listMdFiles(dirPath),
    ...listSubdirs(dirPath).flatMap(listMdFilesRecursive),
  ];
}

/**
 * Rules scoped to file patterns via `paths:` frontmatter. This is Claude Code's equivalent of
 * Cursor's `globs:` and Copilot's `applyTo:`, and is what lets scoping survive a conversion
 * instead of collapsing into one always-on file.
 */
function importScopedRules(rootDir: string): HarnessConfig["rules"] {
  const rulesDir = path.join(rootDir, ".claude", "rules");
  return listMdFilesRecursive(rulesDir).map((filePath) => {
    const raw = fs.readFileSync(filePath, "utf-8");
    const { data, content } = parseFrontmatter(raw);
    return {
      content,
      source: path.basename(filePath),
      globs: getGlobs(data, "paths"),
    };
  });
}

function importRules(rootDir: string): HarnessConfig["rules"] {
  const instructions = INSTRUCTION_FILES.flatMap((segments) => {
    const content = readFileIfExists(path.join(rootDir, ...segments));
    return content ? [{ content, source: segments[segments.length - 1] }] : [];
  });

  return [...instructions, ...importScopedRules(rootDir)];
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

type PermissionsJson = {
  permissions?: { allow?: string[]; ask?: string[]; deny?: string[] };
};

function isPermissionsJson(v: unknown): v is PermissionsJson {
  return typeof v === "object" && v !== null;
}

function parsePermissionEntry(
  entry: string,
  action: PermissionEntry["action"],
): PermissionEntry {
  const match = PERMISSION_PATTERN.exec(entry);
  if (!match) return { tool: entry, pattern: "*", action };
  return { tool: match[1], pattern: match[2] ?? "*", action };
}

/**
 * Permissions live in BOTH .claude/settings.json (project) and .claude/settings.local.json
 * (personal), and each carries allow/ask/deny. Reading only the local file's allow list
 * silently discarded every deny rule.
 */
function importPermissions(rootDir: string): PermissionEntry[] {
  const files = [
    path.join(rootDir, ".claude", "settings.json"),
    path.join(rootDir, ".claude", "settings.local.json"),
  ];
  const actions = ["allow", "ask", "deny"] as const;

  return files.flatMap((file) => {
    const settings = readJsonAs(file, isPermissionsJson);
    if (!settings?.permissions) return [];
    return actions.flatMap((action) =>
      (settings.permissions?.[action] ?? []).map((entry) =>
        parsePermissionEntry(entry, action),
      ),
    );
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

/**
 * Where unscoped rules go.
 *
 * Claude Code loads both `./CLAUDE.md` and `./.claude/CLAUDE.md`, so writing our own copy into a
 * repo that already uses the root convention would duplicate every instruction in context.
 * Prefer whichever already exists; default to `.claude/CLAUDE.md` so a clean target is unchanged
 * from previous versions.
 */
function instructionsPath(rootDir: string): string {
  const root = path.join(rootDir, "CLAUDE.md");
  return fs.existsSync(root) ? root : path.join(rootDir, ".claude", "CLAUDE.md");
}

/**
 * Write rules carrying a glob to `.claude/rules/<name>.md` with `paths:` frontmatter, which is
 * how Claude Code scopes a rule to matching files. Merging these into the always-on instructions
 * file, as earlier versions did, silently made every scoped rule global.
 */
function exportScopedRules(
  rootDir: string,
  rules: HarnessConfig["rules"],
  ctx: WriteContext,
): string[] {
  const rulesDir = path.join(rootDir, ".claude", "rules");
  const names = uniqueSlugs(
    rules.map((r) =>
      r.source ? path.basename(r.source, path.extname(r.source)) : "rule",
    ),
  );

  return rules.flatMap((rule, i) => {
    const filePath = path.join(rulesDir, `${names[i]}.md`);
    const paths = (rule.globs ?? "")
      .split(",")
      .map((g) => g.trim())
      .filter(Boolean);
    const content = serializeFrontmatter({ paths }, rule.content);
    return writeIfNotDry(filePath, content, ctx) ? [filePath] : [];
  });
}

function exportAgents(
  rootDir: string,
  config: HarnessConfig,
  ctx: WriteContext,
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
    const filePath = path.join(rootDir, ".claude", "commands", fileName);
    const frontmatter: Record<string, unknown> = {
      "allowed-tools": cmd.allowedTools?.join(", "),
      description: cmd.description,
    };
    const content = serializeFrontmatter(frontmatter, cmd.body);
    if (writeIfNotDry(filePath, content, ctx)) files.push(filePath);
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
  // Each entry goes to the key matching its own action. Collapsing everything into `allow`
  // is what turned a deny rule into a grant.
  const buckets: Record<string, string[]> = {};
  for (const p of config.permissions) {
    const rendered = p.pattern === "*" ? p.tool : `${p.tool}(${p.pattern})`;
    if (!buckets[p.action]) buckets[p.action] = [];
    buckets[p.action].push(rendered);
  }

  const enabled = config.mcpServers
    .filter((s) => s.enabled !== false)
    .map((s) => s.name);

  const settingsLocal: Record<string, unknown> = {};
  if (Object.keys(buckets).length > 0) settingsLocal.permissions = buckets;
  if (enabled.length > 0) settingsLocal.enabledMcpjsonServers = enabled;
  return settingsLocal;
}

function exportSettings(
  rootDir: string,
  config: HarnessConfig,
  ctx: WriteContext,
): string[] {
  const files: string[] = [];

  if (config.hooks.length > 0 || config.formatters.length > 0) {
    const hooksObj = buildHooksJson(config);
    const filePath = path.join(rootDir, ".claude", "settings.json");
    if (writeIfNotDry(filePath, `${JSON.stringify({ hooks: hooksObj }, null, 2)}\n`, ctx)) {
      files.push(filePath);
    }
  }

  if (config.permissions.length > 0 || config.mcpServers.some((s) => s.enabled)) {
    const settingsLocal = buildSettingsLocalJson(config);
    const filePath = path.join(rootDir, ".claude", "settings.local.json");
    if (writeIfNotDry(filePath, `${JSON.stringify(settingsLocal, null, 2)}\n`, ctx)) {
      files.push(filePath);
    }
  }

  return files;
}


/**
 * Classify one formatter on the way out.
 *
 * Claude Code runs a formatter as a PostToolUse hook, whose `matcher` selects tool names, not file
 * paths — so `Formatter.glob` has nowhere to be stored, and the importer re-derives it from the
 * command. Where that re-derivation would not reproduce the original, the glob silently changes,
 * usually by widening: `*.ts` becoming `*` runs the formatter over every file in the repository.
 * Reusing `inferGlobFromCommand` means this claim and the importer's behaviour cannot disagree.
 */
function formatterItem(fmt: Formatter): FidelityItem {
  const seen = inferGlobFromCommand(fmt.command);
  if (seen === fmt.glob) {
    return { phase: "export", kind: "formatter", name: fmt.glob, status: "exact" };
  }
  return {
    phase: "export",
    kind: "formatter",
    name: fmt.glob,
    status: "lossy",
    reason: `Claude Code hooks match tool names, not file paths, so "${fmt.glob}" is not stored; the glob is re-derived from the command and will be seen as "${seen}"`,
  };
}

export const claudeConverter: Converter = {
  name: "claude",
  label: "Claude Code",
  // Formatters are `full` by way of hooks: imported from a PostToolUse hook matching
  // Edit|Write|MultiEdit whose command ends in $FILEPATH, and written back in that shape.
  capabilities: {
    rule: "full",
    agent: "full",
    skill: "full",
    command: "full",
    mcp: "full",
    permission: "full",
    hook: "full",
    formatter: "full",
  },
  permissionActions: ALL_ACTIONS,

  detect(rootDir: string): boolean {
    // A repo whose only Claude config is skills, agents, or commands is still a Claude repo.
    // Checking three files missed those entirely and reported "no configuration found".
    const candidates = [
      ["CLAUDE.md"],
      ["CLAUDE.local.md"],
      [".mcp.json"],
      [".claude", "CLAUDE.md"],
      [".claude", "settings.json"],
      [".claude", "settings.local.json"],
      [".claude", "rules"],
      [".claude", "skills"],
      [".claude", "agents"],
      [".claude", "commands"],
    ];
    return candidates.some((segments) =>
      fs.existsSync(path.join(rootDir, ...segments)),
    );
  },

  import(rootDir: string): HarnessConfig {
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
    // A rule with a glob is scoped; Claude Code expresses that as `paths:` in .claude/rules/.
    // Everything else is always-on and belongs in the single instructions file.
    const scopedRules = config.rules.filter((r) => r.globs);
    const unscopedRules = config.rules.filter((r) => !r.globs);

    const filesWritten: string[] = [
      ...exportRulesToFile(instructionsPath(rootDir), unscopedRules, ctx),
      ...exportScopedRules(rootDir, scopedRules, ctx),
      ...exportAgents(rootDir, config, ctx),
      ...exportSkillsToDir(
        path.join(rootDir, ".claude", "skills"),
        config.skills,
        ctx,
      ),
      ...exportCommands(rootDir, config, ctx),
      ...exportMcpToJson(
        path.join(rootDir, ".mcp.json"),
        config.mcpServers,
        ctx,
      ),
      ...exportSettings(rootDir, config, ctx),
    ];

    items.push(
      ...exactItems("skill", config.skills.map((s) => s.name)),
      ...exactItems("command", config.commands.map((c) => c.name)),
      ...exactItems("mcp", config.mcpServers.map((s) => s.name)),
      ...exactItems("hook", config.hooks.map((h) => h.event)),
      ...config.formatters.map(formatterItem),
      ...config.permissions.map((p) =>
        permissionStatus(p, claudeConverter.permissionActions, "Claude Code"),
      ),
    );

    // Globs are preserved as `paths:`. A description is not — Claude Code activates a rule by
    // path, not by model decision — so such a rule is written but becomes always-on.
    for (const rule of config.rules) {
      const descriptionOnly = !rule.globs && rule.description;
      items.push({
        phase: "export",
        kind: "rule",
        name: rule.source ?? "project-rules",
        status: descriptionOnly ? "lossy" : "exact",
        ...(descriptionOnly && {
          reason:
            "Claude Code activates rules by path, not by description; this rule was written to the instructions file and is always on",
        }),
      });
    }

    for (const agent of config.agents) {
      const dropped = [
        agent.mode && "mode",
        agent.temperature !== undefined && "temperature",
        agent.permissions && "per-agent permissions",
      ].filter((x): x is string => typeof x === "string");

      items.push({
        phase: "export",
        kind: "agent",
        name: agent.name,
        status: dropped.length > 0 ? "lossy" : "exact",
        ...(dropped.length > 0 && {
          reason: `Claude Code has no agent ${dropped.join(", ")}; dropped`,
        }),
      });
    }

    items.push(...ctx.items);
    return { filesWritten, items };
  },
};

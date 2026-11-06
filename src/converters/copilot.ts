import * as path from "node:path";
import * as fs from "node:fs";
import type { Converter, ExportOptions, ExportResult } from "./types.js";
import { NO_PERMISSIONS } from "./types.js";
import type {
  HarnessConfig,
  Rule,
  Agent,
  Command,
  FidelityItem,
  Hook,
} from "../schema.js";
import type { WriteContext } from "../utils.js";
import {
  readMarkdownFile,
  serializeFrontmatter,
  readFileIfExists,
  getString,
  getStringArray,
  getStringOrFallback,
  importSkillsFromDir,
  exportSkillsToDir,
  importMcpFromJson,
  exportMcpToJson,
  exactItems,
  GUARDRAIL_EVENTS,
  hookStatus,
  permissionStatus,
  writeIfNotDry,
  uniqueSlugs,
  takeReadProblems,
  newWriteContext,
  slugify,
  listMdFiles,
  readJsonIfExists,
} from "../utils.js";

// --- Import ---

function importRules(rootDir: string): Rule[] {
  const rules: Rule[] = [];

  const mainInstructions = readFileIfExists(
    path.join(rootDir, ".github", "copilot-instructions.md"),
  );
  if (mainInstructions) {
    rules.push({
      content: mainInstructions,
      source: "copilot-instructions.md",
      alwaysApply: true,
    });
  }

  const instructionsDir = path.join(rootDir, ".github", "instructions");
  try {
    const files = fs.readdirSync(instructionsDir).filter(
      (f) => f.endsWith(".instructions.md"),
    );
    for (const file of files) {
      const parsed = readMarkdownFile(path.join(instructionsDir, file), "rule");
      if (!parsed) continue;
      const { data, content } = parsed;
      rules.push({
        content,
        source: file,
        globs: getString(data, "applyTo"),
      });
    }
  } catch { /* directory does not exist */
    // no instructions directory
  }

  const agentsMd = readFileIfExists(path.join(rootDir, "AGENTS.md"));
  if (agentsMd) {
    rules.push({ content: agentsMd, source: "AGENTS.md", alwaysApply: true });
  }

  return rules;
}

function importAgents(rootDir: string): Agent[] {
  const agentsDir = path.join(rootDir, ".github", "agents");
  const files = listMdFiles(agentsDir).filter((f) => f.endsWith(".agent.md"));
  return files.flatMap((filePath) => {
    const parsed = readMarkdownFile(filePath, "agent");
    if (!parsed) return [];
    const { data, content } = parsed;
    const modelVal = data.model;
    let model: string | undefined;
    if (typeof modelVal === "string") model = modelVal;
    else if (Array.isArray(modelVal) && typeof modelVal[0] === "string") model = modelVal[0];

    return [{
      name: getStringOrFallback(data, "name", path.basename(filePath, ".agent.md")),
      description: getString(data, "description"),
      model,
      body: content,
      tools: getStringArray(data, "tools"),
    }];
  });
}

function importCommands(rootDir: string): Command[] {
  const promptsDir = path.join(rootDir, ".github", "prompts");
  return listMdFiles(promptsDir).flatMap((filePath) => {
    const parsed = readMarkdownFile(filePath, "command");
    if (!parsed) return [];
    const { data, content } = parsed;
    return [{
      name: path.basename(filePath, ".prompt.md"),
      description: getString(data, "description"),
      body: content,
      allowedTools: getStringArray(data, "tools"),
      agent: getString(data, "agent"),
    }];
  });
}

// Copilot camelCase hook keys and the Claude events they map to.
const COPILOT_TO_CLAUDE: Record<string, string> = {
  preToolUse: "PreToolUse",
  postToolUse: "PostToolUse",
  userPromptSubmitted: "UserPromptSubmit",
  sessionStart: "SessionStart",
  sessionEnd: "SessionEnd",
  agentStop: "Stop",
  preCompact: "PreCompact",
  subagentStop: "SubagentStop",
  errorOccurred: "errorOccurred",
};
const CLAUDE_TO_COPILOT = Object.fromEntries(
  Object.entries(COPILOT_TO_CLAUDE).map(([camel, claude]) => [claude, camel]),
);

const POST_TOOL_USE_NAMES: Record<string, string> = {
  Bash: "bash|powershell",
  Edit: "edit|str_replace_editor|apply_patch",
  Write: "create",
  Read: "view",
  Grep: "grep|rg",
  Glob: "glob",
  WebFetch: "web_fetch",
};

function extractHandler(
  handler: unknown,
): { command: string; matcher?: string; timeout?: number } | undefined {
  if (typeof handler !== "object" || handler === null) return undefined;
  const h = handler as Record<string, unknown>;
  const hookType = typeof h.type === "string" ? h.type : "command";
  if (hookType !== "command") return undefined;
  const command = typeof h.bash === "string" ? h.bash : (typeof h.command === "string" ? h.command : undefined);
  if (command === undefined) return undefined;
  const timeout = typeof h.timeoutSec === "number" ? h.timeoutSec : h.timeout;
  return {
    command,
    ...(typeof h.matcher === "string" && { matcher: h.matcher }),
    ...(typeof timeout === "number" && { timeout }),
  };
}

function importHooks(rootDir: string): Hook[] {
  const hooksDir = path.join(rootDir, ".github", "hooks");
  let files: string[];
  try {
    files = fs.readdirSync(hooksDir).filter((f) => f.endsWith(".json"));
  } catch { /* directory does not exist */
    return [];
  }

  return files.flatMap((file) => {
    const raw = readJsonIfExists(path.join(hooksDir, file));
    if (!raw || typeof raw !== "object") return [];
    const wrapped = (raw as { hooks?: unknown }).hooks;
    const table = typeof wrapped === "object" && wrapped !== null && !Array.isArray(wrapped) ? wrapped : raw;
    return Object.entries(table as Record<string, unknown>).flatMap(([key, handlers]) => {
      if (!Array.isArray(handlers)) return [];
      const camel = Object.hasOwn(COPILOT_TO_CLAUDE, key);
      const event = camel ? COPILOT_TO_CLAUDE[key] : key;
      return handlers.flatMap((h) => {
        const parsed = extractHandler(h);
        return parsed ? [{ event, ...parsed, ...(camel && { dialect: "copilot" as const }) }] : [];
      });
    });
  });
}

// --- Export ---

function exportRules(
  rootDir: string,
  config: HarnessConfig,
  ctx: WriteContext,
): string[] {
  const files: string[] = [];

  const alwaysRules = config.rules.filter(
    (r) => r.alwaysApply || (!r.globs && !r.description),
  );
  const globRules = config.rules.filter((r) => r.globs);
  const descriptionRules = config.rules.filter(
    (r) => !r.alwaysApply && !r.globs && r.description,
  );

  if (alwaysRules.length > 0) {
    const combined = alwaysRules.map((r) => r.content).join("\n\n---\n\n");
    const filePath = path.join(rootDir, ".github", "copilot-instructions.md");
    if (writeIfNotDry(filePath, combined, ctx)) files.push(filePath);
  }

  const instructionsDir = path.join(rootDir, ".github", "instructions");
  const scoped = [...globRules, ...descriptionRules];
  // Rules with no source all fell back to the literal name "rule", so N of them collapsed
  // onto one file. uniqueSlugs keeps each distinct.
  const baseNames = uniqueSlugs(
    scoped.map((rule) =>
      rule.source
        ? path.basename(rule.source, path.extname(rule.source))
        : "rule",
    ),
  );

  scoped.forEach((rule, i) => {
    const filePath = path.join(instructionsDir, `${baseNames[i]}.instructions.md`);

    const frontmatter: Record<string, unknown> = {};
    if (rule.globs) frontmatter.applyTo = rule.globs;

    const content = serializeFrontmatter(frontmatter, rule.content);
    if (writeIfNotDry(filePath, content, ctx)) files.push(filePath);
  });

  return files;
}

function exportAgents(
  rootDir: string,
  agents: Agent[],
  ctx: WriteContext,
): string[] {
  const files: string[] = [];
  for (const agent of agents) {
    const fileName = `${slugify(agent.name)}.agent.md`;
    const filePath = path.join(rootDir, ".github", "agents", fileName);
    const frontmatter: Record<string, unknown> = {
      name: agent.name,
      description: agent.description,
      model: agent.model,
      tools: agent.tools,
    };
    const content = serializeFrontmatter(frontmatter, agent.body);
    if (writeIfNotDry(filePath, content, ctx)) files.push(filePath);
  }
  return files;
}

function exportCommands(
  rootDir: string,
  commands: Command[],
  ctx: WriteContext,
): string[] {
  const files: string[] = [];
  for (const cmd of commands) {
    const fileName = `${slugify(cmd.name)}.prompt.md`;
    const filePath = path.join(rootDir, ".github", "prompts", fileName);
    const frontmatter: Record<string, unknown> = {
      description: cmd.description,
      tools: cmd.allowedTools,
      agent: cmd.agent,
    };
    const content = serializeFrontmatter(frontmatter, cmd.body);
    if (writeIfNotDry(filePath, content, ctx)) files.push(filePath);
  }
  return files;
}

const PRE_TOOL_USE_LOSSY =
  "Copilot reads top-level `permissionDecision`, not nested `hookSpecificOutput`, so a Claude JSON deny is not enforced, and exit 0 with no output counts as allow";

/** The `{item, key, entry}` for one hook; `entry` is absent when the hook is not written. */
function planHook(hook: Hook): { item: FidelityItem; key?: string; entry?: Record<string, unknown> } {
  const claude = (hook.dialect ?? "claude") === "claude";
  const refuse = (limitation: string) => ({ item: hookStatus(hook, "Copilot", limitation) });
  const guardrail = GUARDRAIL_EVENTS.has(hook.event);

  if (hook.args) return refuse("hooks hold one shell string in `bash`, so exec-form `args` cannot be written");
  let matcher = hook.matcher === "*" || hook.matcher === "" ? undefined : hook.matcher;
  let lossy: string | undefined;
  if (claude) {
    if (hook.event === "UserPromptSubmit") return refuse("drops the output of config-file `userPromptSubmitted` hooks");
    if (hook.event === "PermissionRequest") return refuse("has no permission-request hook event");
    if (hook.failClosed && guardrail) return refuse("cannot make a failing hook block the action");
    if (hook.failClosed) lossy = "Copilot cannot make a failing hook block the action";
    else if (hook.event === "PreToolUse") lossy = PRE_TOOL_USE_LOSSY;
    if (hook.event === "PostToolUse" && matcher) {
      const tokens = matcher.split("|");
      const unknown = tokens.find((t) => !Object.hasOwn(POST_TOOL_USE_NAMES, t));
      if (unknown) return refuse(`has no runtime name for the matcher token "${unknown}"`);
      matcher = tokens.map((t) => POST_TOOL_USE_NAMES[t]).join("|");
    }
  }

  const key = claude ? hook.event : (CLAUDE_TO_COPILOT[hook.event] ?? hook.event);
  const entry = {
    type: "command",
    bash: hook.command,
    ...(matcher && { matcher }),
    ...(hook.timeout !== undefined && { timeoutSec: hook.timeout }),
  };
  const item: FidelityItem = lossy
    ? { phase: "export", kind: "hook", name: hook.event, status: "lossy", reason: lossy }
    : { phase: "export", kind: "hook", name: hook.event, status: "exact" };
  return { item, key, entry };
}

function exportHooks(
  rootDir: string,
  hooks: Hook[],
  ctx: WriteContext,
): { files: string[]; items: FidelityItem[] } {
  const plans = hooks.map(planHook);
  const items = plans.map((p) => p.item);
  const table: Record<string, Array<Record<string, unknown>>> = {};
  for (const { key, entry } of plans) {
    if (!key || !entry) continue;
    table[key] ??= [];
    table[key].push(entry);
  }
  if (Object.keys(table).length === 0) return { files: [], items };

  const filePath = path.join(rootDir, ".github", "hooks", "hooks.json");
  const body = `${JSON.stringify({ version: 1, hooks: table }, null, 2)}\n`;
  return { files: writeIfNotDry(filePath, body, ctx) ? [filePath] : [], items };
}

export const copilotConverter: Converter = {
  name: "copilot",
  label: "Copilot",
  // Copilot's hooks run on tool-use events but do not format files, so a Formatter has no target.
  capabilities: {
    rule: "full",
    agent: "full",
    skill: "full",
    command: "full",
    mcp: "full",
    permission: "none",
    hook: "full",
    formatter: "none",
  },
  permissionActions: NO_PERMISSIONS,

  detect(rootDir: string): boolean {
    return (
      fs.existsSync(
        path.join(rootDir, ".github", "copilot-instructions.md"),
      ) ||
      fs.existsSync(path.join(rootDir, ".github", "instructions")) ||
      fs.existsSync(path.join(rootDir, ".github", "agents")) ||
      fs.existsSync(path.join(rootDir, ".github", "skills")) ||
      fs.existsSync(path.join(rootDir, ".copilot", "mcp-config.json"))
    );
  },

  import(rootDir: string): HarnessConfig {
    return {
      rules: importRules(rootDir),
      agents: importAgents(rootDir),
      skills: importSkillsFromDir(path.join(rootDir, ".github", "skills")),
      commands: importCommands(rootDir),
      mcpServers: importMcpFromJson(path.join(rootDir, ".copilot", "mcp-config.json")),
      permissions: [],
      hooks: importHooks(rootDir),
      formatters: [],
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
    const hooksOut = exportHooks(rootDir, config.hooks, ctx);
    const filesWritten: string[] = [
      ...exportRules(rootDir, config, ctx),
      ...exportAgents(rootDir, config.agents, ctx),
      ...exportSkillsToDir(
        path.join(rootDir, ".github", "skills"),
        config.skills,
        ctx,
      ),
      ...exportCommands(rootDir, config.commands, ctx),
      ...exportMcpToJson(
        path.join(rootDir, ".copilot", "mcp-config.json"),
        config.mcpServers,
        ctx,
      ),
      ...hooksOut.files,
    ];

    items.push(
      ...exactItems("rule", config.rules.map((r) => r.source ?? "project-rules")),
      ...exactItems("agent", config.agents.map((a) => a.name)),
      ...exactItems("skill", config.skills.map((s) => s.name)),
      ...exactItems("command", config.commands.map((c) => c.name)),
      ...exactItems("mcp", config.mcpServers.map((s) => s.name)),
      ...hooksOut.items,
      ...config.permissions.map((p) =>
        permissionStatus(p, copilotConverter.permissionActions, "Copilot"),
      ),
    );

    for (const fmt of config.formatters) {
      items.push({
        phase: "export",
        kind: "formatter",
        name: fmt.glob,
        status: "dropped",
        reason:
          "Copilot has no formatter config; its hooks run on tool-use events but do not format files",
      });
    }

    items.push(...ctx.items);
    return { filesWritten, items };
  },
};

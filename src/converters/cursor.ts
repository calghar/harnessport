import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
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
  listMdFiles,
  getString,
  getStringOrFallback,
  getBoolean,
  getGlobs,
  importMcpFromJson,
  importSkillsFromDir,
  exportMcpToJson,
  exportSkillsToDir,
  generateDropItems,
  exactItems,
  permissionStatus,
  hookStatus,
  GUARDRAIL_EVENTS,
  writeIfNotDry,
  takeReadProblems,
  newWriteContext,
  slugify,
} from "../utils.js";

// --- Import ---

function importRules(rootDir: string): Rule[] {
  const rules: Rule[] = [];

  const rulesDir = path.join(rootDir, ".cursor", "rules");
  try {
    const files = fs.readdirSync(rulesDir).filter(
      (f) => f.endsWith(".mdc") || f.endsWith(".md"),
    );
    for (const file of files) {
      const parsed = readMarkdownFile(path.join(rulesDir, file), "rule");
      if (!parsed) continue;
      const { data, content } = parsed;
      rules.push({
        content,
        source: file,
        description: getString(data, "description"),
        globs: getGlobs(data),
        alwaysApply: getBoolean(data, "alwaysApply"),
      });
    }
  } catch { /* directory does not exist */
    // no cursor rules directory
  }

  const legacyRules = readFileIfExists(path.join(rootDir, ".cursorrules"));
  if (legacyRules) {
    rules.push({ content: legacyRules, source: ".cursorrules", alwaysApply: true });
  }

  const agentsMd = readFileIfExists(path.join(rootDir, "AGENTS.md"));
  if (agentsMd) {
    rules.push({ content: agentsMd, source: "AGENTS.md", alwaysApply: true });
  }

  return rules;
}

function importCommands(rootDir: string): Command[] {
  const commandsDir = path.join(rootDir, ".cursor", "commands");
  return listMdFiles(commandsDir).map((filePath) => {
    const raw = fs.readFileSync(filePath, "utf-8");
    // Cursor commands have NO frontmatter — plain markdown only
    return {
      name: path.basename(filePath, ".md"),
      body: raw.trim(),
    };
  });
}

function importAgents(rootDir: string): Agent[] {
  const agentsDir = path.join(rootDir, ".cursor", "agents");
  return listMdFiles(agentsDir).flatMap((filePath) => {
    const parsed = readMarkdownFile(filePath, "agent");
    if (!parsed) return [];
    const { data, content } = parsed;
    return [{
      name: getStringOrFallback(data, "name", path.basename(filePath, ".md")),
      description: getString(data, "description"),
      model: getString(data, "model"),
      body: content,
    }];
  });
}

// --- Export ---

function exportRules(
  rootDir: string,
  config: HarnessConfig,
  ctx: WriteContext,
): string[] {
  const files: string[] = [];
  const rulesDir = path.join(rootDir, ".cursor", "rules");

  for (const rule of config.rules) {
    const fileName = rule.source
      ? `${slugify(path.basename(rule.source, path.extname(rule.source)))}.mdc`
      : "project-rules.mdc";
    const filePath = path.join(rulesDir, fileName);

    const frontmatter: Record<string, unknown> = {
      description: rule.description ?? "",
      globs: rule.globs ?? "",
      alwaysApply: rule.alwaysApply ?? (!rule.globs && !rule.description),
    };

    const content = serializeFrontmatter(frontmatter, rule.content);
    if (writeIfNotDry(filePath, content, ctx)) files.push(filePath);
  }

  return files;
}

function exportCommands(
  rootDir: string,
  commands: Command[],
  ctx: WriteContext,
): string[] {
  const commandsDir = path.join(rootDir, ".cursor", "commands");
  return commands.flatMap((cmd) => {
    const fileName = `${slugify(cmd.name)}.md`;
    const filePath = path.join(commandsDir, fileName);
    // Cursor commands are plain markdown — no frontmatter
    return writeIfNotDry(filePath, cmd.body, ctx) ? [filePath] : [];
  });
}

function exportAgents(
  rootDir: string,
  agents: Agent[],
  ctx: WriteContext,
): string[] {
  const agentsDir = path.join(rootDir, ".cursor", "agents");
  return agents.flatMap((agent) => {
    const fileName = `${slugify(agent.name)}.md`;
    const filePath = path.join(agentsDir, fileName);
    const frontmatter: Record<string, unknown> = {
      name: agent.name,
      model: agent.model,
      description: agent.description,
    };
    const content = serializeFrontmatter(frontmatter, agent.body);
    return writeIfNotDry(filePath, content, ctx) ? [filePath] : [];
  });
}

// --- Hooks ---

// Cursor loads other hook events from .claude/settings.json itself, so only preToolUse is written.
const WRAPPER_TEMPLATE = [
  'import { spawnSync } from "node:child_process";',
  'import { readFileSync } from "node:fs";',
  "const ALLOW = new Set([\"allow\", \"approve\"]);",
  "const DENY = new Set([\"deny\", \"ask\", \"block\"]);",
  "const end = (code, message) => {",
  "  if (message) process.stderr.write(message + \"\\n\");",
  "  process.exitCode = code;",
  "};",
  "function main() {",
  "  let input;",
  "  try { input = JSON.parse(readFileSync(0, \"utf-8\")); } catch (e) { return end(1, \"harnessport-guard: stdin is not JSON\"); }",
  "  if (input && input.tool_name === \"Shell\") input.tool_name = \"Bash\";",
  "  const opts = { input: JSON.stringify(input), encoding: \"utf-8\" };",
  "  const r = HOOK.args ? spawnSync(HOOK.command, HOOK.args, opts) : spawnSync(HOOK.command, { ...opts, shell: true });",
  "  if (r.error || r.status === null) return end(1, \"harnessport-guard: command did not run: \" + (r.error ? r.error.message : r.signal));",
  "  if (r.status === 2) return end(2, r.stderr);",
  "  if (r.status !== 0) return end(1, \"harnessport-guard: command exited \" + r.status + \"\\n\" + r.stderr);",
  "  const text = r.stdout.trim();",
  "  const allow = (updated) => { process.stdout.write(JSON.stringify(updated ? { permission: \"allow\", updated_input: updated } : { permission: \"allow\" })); };",
  "  if (text === \"\") return allow();",
  "  let out;",
  "  try { out = JSON.parse(text); } catch (e) { return end(2, \"harnessport-guard: command output is not JSON\"); }",
  "  if (out === null || typeof out !== \"object\" || Array.isArray(out)) return end(2, \"harnessport-guard: command output is not a JSON object\");",
  "  const hso = out.hookSpecificOutput && typeof out.hookSpecificOutput === \"object\" ? out.hookSpecificOutput : {};",
  "  const decisions = [hso.permissionDecision, out.permissionDecision, out.decision].filter((d) => d !== undefined);",
  "  const reason = hso.permissionDecisionReason ?? out.permissionDecisionReason ?? out.reason;",
  "  if (decisions.some((d) => DENY.has(d))) return end(2, reason || \"denied by hook\");",
  "  if (decisions.some((d) => !ALLOW.has(d))) return end(2, \"harnessport-guard: unknown decision \" + JSON.stringify(decisions));",
  "  const updated = hso.updatedInput ?? out.updatedInput;",
  "  return allow(updated && typeof updated === \"object\" ? updated : undefined);",
  "}",
  "main();",
  "",
].join("\n");

const wrapperSource = (hook: Hook): string =>
  `const HOOK = ${JSON.stringify({ command: hook.command, ...(hook.args && { args: hook.args }) })};\n${WRAPPER_TEMPLATE}`;

const CURSOR_TOOLS: Record<string, string> = {
  Bash: "Shell",
  Read: "Read",
  Write: "Write",
  Grep: "Grep",
  Edit: "Write",
  MultiEdit: "Write",
};
const EDIT_TOKENS = new Set(["Edit", "MultiEdit"]);
const MATCHER_SAFE = /^[A-Za-z0-9_|]*$/;

const REASON_NODE = "the wrapper needs `node` on PATH";
const REASON_TWICE =
  "the command runs twice when `.claude/settings.json` also holds it and Third-Party Imports is on";
const REASON_EDIT = "Cursor `Write` covers both creates and edits";
const REASON_STAR = "Cursor tool names other than `Shell` reach the script unrenamed";
const REASON_NOT_WRITTEN = "runs this hook only if `.claude/settings.json` holds it and Third-Party Imports is on";

/** Cursor matcher plus the lossy reasons, or the first token that cannot be mapped. */
function mapMatcher(
  matcher: string | undefined,
): { matcher: string; reasons: string[] } | { blocked: string } {
  if (matcher === undefined || matcher === "" || matcher === "*") {
    return { matcher: "*", reasons: [REASON_STAR] };
  }
  const tokens = matcher.split("|");
  const bad = MATCHER_SAFE.test(matcher) ? tokens.find((t) => !(t in CURSOR_TOOLS)) : matcher;
  if (bad !== undefined) return { blocked: bad };
  return {
    matcher: [...new Set(tokens.map((t) => CURSOR_TOOLS[t]))].join("|"),
    reasons: tokens.some((t) => EDIT_TOKENS.has(t)) ? [REASON_EDIT] : [],
  };
}

function exportHooks(
  rootDir: string,
  hooks: Hook[],
  ctx: WriteContext,
  userLevel: boolean,
): { files: string[]; items: FidelityItem[] } {
  const items: FidelityItem[] = [];
  const files: string[] = [];
  const entries: Array<Record<string, unknown>> = [];
  const hooksDir = path.join(rootDir, ".cursor", "hooks");

  for (const hook of hooks) {
    if (hook.event !== "PreToolUse") {
      items.push(
        hookStatus(
          hook,
          "Cursor",
          GUARDRAIL_EVENTS.has(hook.event)
            ? `has no ${hook.event} hook event with a verified block contract`
            : REASON_NOT_WRITTEN,
        ),
      );
      continue;
    }
    if (hook.dialect && hook.dialect !== "claude") {
      items.push(hookStatus(hook, "Cursor", `does not accept hooks of dialect "${hook.dialect}"`));
      continue;
    }
    const mapped = mapMatcher(hook.matcher);
    if ("blocked" in mapped) {
      items.push(hookStatus(hook, "Cursor", `cannot map the matcher token \`${mapped.blocked}\``));
      continue;
    }
    const n = entries.length + 1;
    const wrapper = path.join(hooksDir, `harnessport-guard-${n}.mjs`);
    if (writeIfNotDry(wrapper, wrapperSource(hook), ctx)) files.push(wrapper);
    entries.push({
      command: userLevel
        ? `node "${wrapper}"`
        : `node ${path.relative(rootDir, wrapper)}`,
      matcher: mapped.matcher,
      ...(hook.timeout !== undefined && { timeout: hook.timeout }),
      ...(hook.failClosed && { failClosed: true }),
    });
    const reasons = [...mapped.reasons, REASON_NODE, REASON_TWICE];
    items.push({
      phase: "export",
      kind: "hook",
      name: hook.event,
      status: mapped.reasons.length > 0 ? "lossy" : "exact",
      reason: reasons.join("; "),
    });
  }
  if (entries.length === 0) return { files, items };

  const stale = (fs.existsSync(hooksDir) ? fs.readdirSync(hooksDir) : []).filter((f) => {
    const m = /^harnessport-guard-(\d+)\.mjs$/.exec(f);
    return m !== null && Number(m[1]) > entries.length;
  });
  if (stale.length > 0) {
    const last = items.filter((i) => i.status === "exact" || i.status === "lossy").at(-1);
    if (last) last.reason += `; stale wrapper files remain and are not referenced: ${stale.join(", ")}`;
  }

  const filePath = path.join(rootDir, ".cursor", "hooks.json");
  const json = { version: 1, hooks: { preToolUse: entries } };
  if (writeIfNotDry(filePath, `${JSON.stringify(json, null, 2)}\n`, ctx)) files.push(filePath);
  return { files, items };
}

// --- Converter ---

export const cursorConverter: Converter = {
  name: "cursor",
  label: "Cursor",
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
    const cursorDir = path.join(rootDir, ".cursor");
    return (
      fs.existsSync(path.join(cursorDir, "rules")) ||
      fs.existsSync(path.join(cursorDir, "commands")) ||
      fs.existsSync(path.join(cursorDir, "agents")) ||
      fs.existsSync(path.join(cursorDir, "skills")) ||
      fs.existsSync(path.join(cursorDir, "mcp.json")) ||
      fs.existsSync(path.join(rootDir, ".cursorrules"))
    );
  },

  import(rootDir: string): HarnessConfig {
    const cursorDir = path.join(rootDir, ".cursor");
    return {
      rules: importRules(rootDir),
      agents: importAgents(rootDir),
      skills: importSkillsFromDir(path.join(cursorDir, "skills")),
      commands: importCommands(rootDir),
      mcpServers: importMcpFromJson(path.join(cursorDir, "mcp.json")),
      permissions: [],
      hooks: [],
      formatters: [],
      items: takeReadProblems(),
    };
  },

  export(
    rootDir: string,
    config: HarnessConfig,
    options: ExportOptions & { homeDir?: string } = {},
  ): ExportResult {
    const ctx = newWriteContext(options);
    const cursorDir = path.join(rootDir, ".cursor");
    const items: FidelityItem[] = [...config.items];
    const homeDir = options.homeDir ?? os.homedir();
    const hookExport = exportHooks(
      rootDir,
      config.hooks,
      ctx,
      path.resolve(rootDir) === path.resolve(homeDir),
    );
    const filesWritten: string[] = [
      ...hookExport.files,
      ...exportRules(rootDir, config, ctx),
      ...exportCommands(rootDir, config.commands, ctx),
      ...exportAgents(rootDir, config.agents, ctx),
      ...exportSkillsToDir(path.join(cursorDir, "skills"), config.skills, ctx),
      ...exportMcpToJson(path.join(cursorDir, "mcp.json"), config.mcpServers, ctx),
    ];

    items.push(
      ...generateDropItems(config, {
        targetName: "Cursor",
        formatters: "Cursor exports hooks but has no formatter config",
      }),
      ...exactItems("rule", config.rules.map((r) => r.source ?? "project-rules")),
      ...exactItems("agent", config.agents.map((a) => a.name)),
      ...exactItems("skill", config.skills.map((s) => s.name)),
      ...exactItems("command", config.commands.map((c) => c.name)),
      ...exactItems("mcp", config.mcpServers.map((s) => s.name)),
      ...config.permissions.map((p) =>
        permissionStatus(p, cursorConverter.permissionActions, "Cursor"),
      ),
    );

    items.push(...hookExport.items, ...ctx.items);
    return { filesWritten, items };
  },
};

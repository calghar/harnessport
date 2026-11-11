import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import type { Converter, ExportOptions, ExportResult } from "./types.js";
import { ALL_ACTIONS, NO_PERMISSIONS } from "./types.js";
import {
  FORMAT_RUNNER_MARKER,
  formatRunnerSource,
  formatterItem,
  parseRunnerCommand,
  writableFormatters,
} from "./formatter-runner.js";
import type {
  HarnessConfig,
  Rule,
  Agent,
  Command,
  FidelityItem,
  Hook,
  Formatter,
  PermissionEntry,
} from "../schema.js";
import type { WriteContext } from "../utils.js";
import {
  readMarkdownFile,
  serializeFrontmatter,
  readFileIfExists,
  readJsonAs,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

function isAfterFileEditJson(v: unknown): v is { hooks?: { afterFileEdit?: Array<{ command?: unknown }> } } {
  return typeof v === "object" && v !== null;
}

/** Runner entries become formatters. Every other `afterFileEdit` entry is reported dropped. */
function importFormatters(rootDir: string): { formatters: Formatter[]; items: FidelityItem[] } {
  const json = readJsonAs(path.join(rootDir, ".cursor", "hooks.json"), isAfterFileEditJson);
  const entries = Array.isArray(json?.hooks?.afterFileEdit) ? json.hooks.afterFileEdit : [];
  const formatters: Formatter[] = [];
  const items: FidelityItem[] = [];
  for (const entry of entries) {
    const command = typeof entry?.command === "string" ? entry.command : "";
    const parsed = command.includes(FORMAT_RUNNER_MARKER) ? parseRunnerCommand(command) : undefined;
    if (parsed) {
      formatters.push(parsed);
    } else {
      items.push(
        hookStatus(
          { event: "afterFileEdit", command },
          "Cursor",
          "imports only harnessport formatter entries from afterFileEdit",
          "import",
        ),
      );
    }
  }
  return { formatters, items };
}

function generatedWrapperMetadata(
  filePath: string,
  constant: "HOOK" | "MCP_ASK" | "MODEL_LOG",
): unknown {
  if (!fs.existsSync(filePath)) return undefined;
  const firstLine = fs.readFileSync(filePath, "utf-8").split(/\r?\n/, 1)[0];
  const prefix = `const ${constant} = `;
  if (!firstLine.startsWith(prefix) || !firstLine.endsWith(";")) return undefined;
  try {
    return JSON.parse(firstLine.slice(prefix.length, -1));
  } catch {
    return undefined;
  }
}

function generatedWrapperPath(command: string, rootDir: string): string | undefined {
  const match = /^node\s+(?:"([^"]+)"|(\S+))$/.exec(command.trim());
  if (!match) return undefined;
  const file = match[1] ?? match[2];
  return path.isAbsolute(file) ? file : path.join(rootDir, file);
}

function importHooks(
  rootDir: string,
): { hooks: Hook[]; permissions: PermissionEntry[]; items: FidelityItem[] } {
  const json = readJsonAs(path.join(rootDir, ".cursor", "hooks.json"), isRecord);
  const hooks: Hook[] = [];
  const permissions: PermissionEntry[] = [];
  const items: FidelityItem[] = [];
  const seen = new Set<string>();
  if (!json || !isRecord(json.hooks)) return { hooks, permissions, items };

  for (const [cursorEvent, rawEntries] of Object.entries(json.hooks)) {
    const entries = Array.isArray(rawEntries) ? rawEntries : [rawEntries];
    for (const rawEntry of entries) {
      if (!isRecord(rawEntry) || typeof rawEntry.command !== "string") continue;
      if (cursorEvent === "afterFileEdit" && rawEntry.command.includes(FORMAT_RUNNER_MARKER)) continue;
      const file = generatedWrapperPath(rawEntry.command, rootDir);
      if (!file) {
        items.push(hookStatus(
          { event: cursorEvent, command: rawEntry.command },
          "Cursor",
          "foreign Cursor hook commands have no Claude hook mapping",
          "import",
        ));
        continue;
      }

      if (generatedWrapperMetadata(file, "MODEL_LOG") !== undefined) {
        items.push(hookStatus(
          { event: cursorEvent, command: rawEntry.command },
          "Cursor",
          REASON_MODEL_LOG_IMPORT,
          "import",
        ));
        continue;
      }

      const mcp = generatedWrapperMetadata(file, "MCP_ASK");
      if (isRecord(mcp) && typeof mcp.server === "string" && typeof mcp.tool === "string") {
        permissions.push({
          tool: `mcp__${mcp.server}__${mcp.tool}`,
          pattern: "*",
          action: "ask",
        });
        continue;
      }

      const metadata = generatedWrapperMetadata(file, "HOOK");
      if (!isRecord(metadata) || metadata.record === true) {
        if (!isRecord(metadata)) {
          items.push(hookStatus(
            { event: cursorEvent, command: rawEntry.command },
            "Cursor",
            "the Cursor hook is not a generated harnessport guard",
            "import",
          ));
        }
        continue;
      }
      if (
        typeof metadata.sourceEvent !== "string" ||
        (metadata.sourceEvent !== "PreToolUse" && !(metadata.sourceEvent in HOOK_EVENTS))
      ) {
        items.push(hookStatus(
          { event: cursorEvent, command: rawEntry.command },
          "Cursor",
          "the generated wrapper does not identify a Claude event",
          "import",
        ));
        continue;
      }
      const hook: Hook = {
        event: metadata.sourceEvent,
        matcher: typeof metadata.matcher === "string" ? metadata.matcher : undefined,
        command: typeof metadata.command === "string" ? metadata.command : "",
        args: Array.isArray(metadata.args) && metadata.args.every((arg) => typeof arg === "string")
          ? metadata.args
          : [],
        timeout: typeof metadata.timeout === "number" ? metadata.timeout : undefined,
        failClosed: typeof metadata.failClosed === "boolean" ? metadata.failClosed : undefined,
      };
      if (hook.command === "") continue;
      const key = JSON.stringify(hook);
      if (!seen.has(key)) {
        seen.add(key);
        hooks.push(hook);
      }
    }
  }
  return { hooks, permissions, items };
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

// Events without a Cursor equivalent stay in `.claude/settings.json`, which Cursor loads itself.
const WRAPPER_TEMPLATE = [
  'import { spawnSync } from "node:child_process";',
  'import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";',
  'import { tmpdir } from "node:os";',
  'import { join } from "node:path";',
  "const ALLOW = new Set([\"allow\", \"approve\"]);",
  "const DENY = new Set([\"deny\", \"ask\", \"block\"]);",
  "const end = (code, message) => {",
  "  if (message) process.stderr.write(message + \"\\n\");",
  "  process.exitCode = code;",
  "};",
  "const run = (input) => {",
  "  const opts = { input: JSON.stringify(input), encoding: \"utf-8\" };",
  "  return HOOK.args ? spawnSync(HOOK.command, HOOK.args, opts) : spawnSync(HOOK.command, { ...opts, shell: true });",
  "};",
  "const write = (o) => { process.stdout.write(JSON.stringify(o)); };",
  "const CONTEXT = new Set([\"SessionStart\", \"PostToolUse\", \"PostToolUseFailure\"]);",
  "function relay(input) {",
  "  const ev = HOOK.event;",
  "  const r = run({ ...input, hook_event_name: ev, ...(input.tool_output !== undefined && { tool_response: input.tool_output }) });",
  "  if (r.error || r.status === null) return end(1, \"harnessport-guard: command did not run: \" + (r.error ? r.error.message : r.signal));",
  "  if (r.status !== 0 && r.status !== 2) return end(1, \"harnessport-guard: command exited \" + r.status + \"\\n\" + r.stderr);",
  "  let out = {};",
  "  const text = r.stdout.trim();",
  "  if (text !== \"\") { try { const p = JSON.parse(text); if (p && typeof p === \"object\" && !Array.isArray(p)) out = p; } catch (e) { process.stderr.write(text + \"\\n\"); } }",
  "  const hso = out.hookSpecificOutput && typeof out.hookSpecificOutput === \"object\" ? out.hookSpecificOutput : {};",
  "  const decision = hso.permissionDecision ?? out.permissionDecision ?? out.decision;",
  "  const blocked = r.status === 2 || DENY.has(decision);",
  "  const msg = hso.permissionDecisionReason ?? out.permissionDecisionReason ?? out.reason ?? (r.stderr.trim() || \"blocked by hook\");",
  "  if (ev === \"UserPromptSubmit\") return write(blocked ? { continue: false, user_message: msg } : { continue: true });",
  "  if (ev === \"SubagentStart\") return write(blocked ? { permission: \"deny\", user_message: msg } : { permission: \"allow\" });",
  "  if (ev === \"Stop\" || ev === \"SubagentStop\") { if (blocked) write({ followup_message: msg }); return; }",
  "  const context = hso.additionalContext ?? out.additionalContext;",
  "  if (CONTEXT.has(ev) && typeof context === \"string\") write({ additional_context: context });",
  "}",
  "const MARKERS = join(tmpdir(), \"harnessport-read\");",
  "const markerId = (i) => { const id = i && i.tool_use_id; return typeof id === \"string\" && id !== \"\" && !/[\\\\/]|\\.\\./.test(id) ? id : undefined; };",
  "function record(input) {",
  "  const id = markerId(input);",
  "  if (id) {",
  "    try {",
  "      mkdirSync(MARKERS, { recursive: true });",
  "      for (const f of readdirSync(MARKERS)) { try { if (Date.now() - statSync(join(MARKERS, f)).mtimeMs > 3600000) unlinkSync(join(MARKERS, f)); } catch (e) { /* raced */ } }",
  "      writeFileSync(join(MARKERS, id), \"\");",
  "    } catch (e) { /* no marker: the read is allowed */ }",
  "  }",
  "  write({ permission: \"allow\" });",
  "}",
  "function main() {",
  "  let input;",
  "  try { input = JSON.parse(readFileSync(0, \"utf-8\")); } catch (e) { return end(1, \"harnessport-guard: stdin is not JSON\"); }",
  "  if (input && input.tool_name === \"Shell\") input.tool_name = \"Bash\";",
  "  if (input && input.tool_name === \"Subagent\") input.tool_name = \"Agent\";",
  "  if (HOOK.record) return record(input);",
  "  if (HOOK.event) return relay(input);",
  "  const shellEvent = !!input && (input.hook_event_name === \"beforeShellExecution\" || (input.tool_name === undefined && typeof input.command === \"string\"));",
  "  if (shellEvent) input = { ...input, tool_name: \"Bash\", tool_input: { command: input.command, working_directory: input.cwd } };",
  "  const lines = (s) => { const n = s.split(\"\\n\").length; return s.endsWith(\"\\n\") ? n - 1 : n; };",
  "  const readEvent = !!input && (input.hook_event_name === \"beforeReadFile\" || (input.tool_name === undefined && typeof input.file_path === \"string\" && typeof input.content === \"string\"));",
  "  if (readEvent) {",
  "    const id = markerId(input);",
  "    if (id) { const m = join(MARKERS, id); if (!existsSync(m)) return write({ permission: \"allow\" }); try { unlinkSync(m); } catch (e) { /* already gone */ } }",
  "    const tool_input = { file_path: input.file_path };",
  "    try { const got = lines(input.content); if (got < lines(readFileSync(input.file_path, \"utf-8\"))) tool_input.limit = got; } catch (e) { /* unreadable file: no limit */ }",
  "    input = { ...input, tool_name: \"Read\", tool_input };",
  "  }",
  "  const r = run(input);",
  "  if (r.error || r.status === null) return end(1, \"harnessport-guard: command did not run: \" + (r.error ? r.error.message : r.signal));",
  "  if (r.status === 2) return end(2, r.stderr);",
  "  if (r.status !== 0) return end(1, \"harnessport-guard: command exited \" + r.status + \"\\n\" + r.stderr);",
  "  const text = r.stdout.trim();",
  "  const allow = (updated) => { process.stdout.write(JSON.stringify(updated ? { permission: \"allow\", updated_input: updated } : { permission: \"allow\" })); };",
  "  if (text === \"\") return allow();",
  "  let out;",
  "  try { out = JSON.parse(text); } catch (e) { process.stderr.write(text + \"\\n\"); return allow(); }",
  "  if (out === null || typeof out !== \"object\" || Array.isArray(out)) return end(2, \"harnessport-guard: command output is not a JSON object\");",
  "  const hso = out.hookSpecificOutput && typeof out.hookSpecificOutput === \"object\" ? out.hookSpecificOutput : {};",
  "  const decisions = [hso.permissionDecision, out.permissionDecision, out.decision].filter((d) => d !== undefined);",
  "  const reason = hso.permissionDecisionReason ?? out.permissionDecisionReason ?? out.reason;",
  "  if (shellEvent && decisions.includes(\"ask\") && !decisions.some((d) => d === \"deny\" || d === \"block\")) { const m = reason || \"confirmation required\"; process.stdout.write(JSON.stringify({ permission: \"ask\", user_message: m, agent_message: m })); return; }",
  "  if (decisions.some((d) => DENY.has(d))) return end(2, reason || \"denied by hook\");",
  "  if (decisions.some((d) => !ALLOW.has(d))) return end(2, \"harnessport-guard: unknown decision \" + JSON.stringify(decisions));",
  "  const updated = hso.updatedInput ?? out.updatedInput;",
  "  return allow(updated && typeof updated === \"object\" ? updated : undefined);",
  "}",
  "main();",
  "",
].join("\n");

const wrapperSource = (hook: Hook, event?: string, record?: boolean): string =>
  `const HOOK = ${JSON.stringify({
    command: hook.command,
    sourceEvent: hook.event,
    ...(hook.matcher && { matcher: hook.matcher }),
    ...(hook.args && { args: hook.args }),
    ...(hook.timeout !== undefined && { timeout: hook.timeout }),
    ...(hook.failClosed !== undefined && { failClosed: hook.failClosed }),
    ...(event && { event }),
    ...(record && { record }),
  })};\n${WRAPPER_TEMPLATE}`;

const mcpAskSource = (server: string, tool: string): string => [
  `const MCP_ASK = ${JSON.stringify({ server, tool })};`,
  'import { readFileSync } from "node:fs";',
  "let input;",
  'try { input = JSON.parse(readFileSync(0, "utf-8")); } catch (e) { process.exit(1); }',
  `const matches = input?.mcp_server_name === ${JSON.stringify(server)} && input?.tool_name === ${JSON.stringify(tool)};`,
  'process.stdout.write(JSON.stringify(matches ? { permission: "ask", user_message: "confirmation required", agent_message: "confirmation required" } : { permission: "allow" }));',
  "",
].join("\n");

const REASON_MODEL_LOG_IMPORT = "the harnessport model log is Cursor-only and has no Claude hook mapping";
const MODEL_LOG_REL = ".cursor/hooks/harnessport-model-log.mjs";

const modelLogSource = (): string => [
  'const MODEL_LOG = {"version":1};',
  'import { appendFileSync, readFileSync } from "node:fs";',
  'const KEYS = ["conversation_id", "generation_id", "model", "model_id"];',
  "try {",
  '  const input = JSON.parse(readFileSync(0, "utf-8"));',
  '  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("stdin is not a JSON object");',
  "  const line = { timestamp: new Date().toISOString() };",
  "  for (const k of KEYS) if (input[k] !== undefined) line[k] = input[k];",
  '  appendFileSync(new URL("../harnessport-model.jsonl", import.meta.url), JSON.stringify(line) + "\\n");',
  '} catch (e) { process.stderr.write("harnessport-model-log: " + String(e.message).split("\\n")[0] + "\\n"); }',
  "",
].join("\n");

const CURSOR_TOOLS: Record<string, string> = {
  Bash: "Shell",
  Agent: "Subagent",
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
const REASON_READ =
  "enforced on `beforeReadFile` for reads that passed `preToolUse` first, with the range recovered from the content line count; Cursor's own whole-file reads for edits are allowed; the event order is unverified";
const REASON_STAR = "Cursor tool names other than `Shell` and `Subagent` reach the script unrenamed";
const REASON_HOOKS_REFUSED =
  "`.cursor/hooks.json` or the formatter runner already exists with different content; this formatter was not written";
const REASON_GUARD_REFUSED = "`.cursor/hooks.json` already exists with different content; this guardrail was not written";
const REASON_FORMAT_TWICE =
  "the formatter runs twice when `.claude/settings.json` also holds it and Third-Party Imports is on";
const REASON_NOT_WRITTEN = "runs this hook only if `.claude/settings.json` holds it and Third-Party Imports is on";

function parseClaudeMcpTool(tool: string): { server: string; tool: string } | undefined {
  const match = /^mcp__(.+?)__(.+)$/.exec(tool);
  return match ? { server: match[1], tool: match[2] } : undefined;
}

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
    reasons: [
      ...(tokens.some((t) => EDIT_TOKENS.has(t)) ? [REASON_EDIT] : []),
    ],
  };
}

type EventSpec = {
  cursor: string;
  matcher: "tool" | "type" | "none";
  status: "exact" | "lossy";
  reason?: string;
};
const HOOK_EVENTS: Record<string, EventSpec> = {
  SessionStart: { cursor: "sessionStart", matcher: "none", status: "lossy", reason: "Cursor `sessionStart` accepts only `additional_context` and `env` from the hook" },
  SessionEnd: { cursor: "sessionEnd", matcher: "none", status: "exact" },
  Stop: { cursor: "stop", matcher: "none", status: "lossy", reason: "a Claude block becomes a `followup_message`, capped by `loop_limit` (default 5)" },
  SubagentStart: { cursor: "subagentStart", matcher: "type", status: "lossy", reason: "one observed Cursor CLI spawn emitted `preToolUse` for `Subagent` but did not emit `subagentStart`" },
  SubagentStop: { cursor: "subagentStop", matcher: "type", status: "lossy", reason: "`followup_message` applies on `completed` only and is capped by `loop_limit`" },
  PreCompact: { cursor: "preCompact", matcher: "none", status: "lossy", reason: "Cursor `preCompact` is an observer and cannot block" },
  UserPromptSubmit: { cursor: "beforeSubmitPrompt", matcher: "none", status: "lossy", reason: "Cursor `beforeSubmitPrompt` cannot add context to the prompt" },
  PostToolUse: { cursor: "postToolUse", matcher: "tool", status: "lossy", reason: "Cursor `postToolUse` cannot block the tool result" },
  PostToolUseFailure: { cursor: "postToolUseFailure", matcher: "tool", status: "lossy", reason: "Cursor `postToolUseFailure` cannot block" },
};

const FORMAT_RUNNER_REL = `.cursor/hooks/${FORMAT_RUNNER_MARKER}`;

function exportHooks(
  rootDir: string,
  config: HarnessConfig,
  ctx: WriteContext,
  userLevel: boolean,
  logModel = false,
): { files: string[]; items: FidelityItem[] } {
  const items: FidelityItem[] = [];
  const files: string[] = [];
  const entries: Array<Record<string, unknown>> = [];
  const shellEntries: Array<Record<string, unknown>> = [];
  const hooksDir = path.join(rootDir, ".cursor", "hooks");
  const readEntries: Array<Record<string, unknown>> = [];
  const eventEntries: Record<string, Array<Record<string, unknown>>> = {};
  let written = 0;
  const emit = (hook: Hook, target: Array<Record<string, unknown>>, matcher?: string, event?: string, record?: boolean): void => {
    written += 1;
    const wrapper = path.join(hooksDir, `harnessport-guard-${written}.mjs`);
    if (writeIfNotDry(wrapper, wrapperSource(hook, event, record), ctx)) files.push(wrapper);
    target.push({
      command: userLevel ? `node "${wrapper}"` : `node ${path.relative(rootDir, wrapper)}`,
      ...(matcher && { matcher }),
      ...(hook.timeout !== undefined && { timeout: hook.timeout }),
      ...(hook.failClosed && { failClosed: true }),
    });
  };
  // The marker recorder never runs the Claude command, so it carries no timeout or failClosed.
  const emitRecorder = (hook: Hook): void => emit({ ...hook, timeout: undefined, failClosed: false }, entries, "Read", undefined, true);

  for (const permission of config.permissions) {
    if (permission.action !== "ask" || permission.pattern !== "*") continue;
    const mcp = parseClaudeMcpTool(permission.tool);
    if (!mcp) continue;
    written += 1;
    const wrapper = path.join(hooksDir, `harnessport-guard-${written}.mjs`);
    if (writeIfNotDry(wrapper, mcpAskSource(mcp.server, mcp.tool), ctx)) files.push(wrapper);
    const bucket = eventEntries.beforeMCPExecution ?? [];
    eventEntries.beforeMCPExecution = bucket;
    bucket.push({
      command: userLevel ? `node "${wrapper}"` : `node ${path.relative(rootDir, wrapper)}`,
    });
    items.push({
      phase: "export",
      kind: "permission",
      name: `${permission.tool}(*)`,
      status: "exact",
    });
  }

  for (const hook of config.hooks) {
    const spec = HOOK_EVENTS[hook.event];
    if (hook.event !== "PreToolUse" && !spec) {
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
    if (spec) {
      if (hook.event === "PreCompact" && hook.failClosed) {
        items.push({ phase: "export", kind: "hook", name: hook.event, status: "blocked", reason: "Cursor `preCompact` cannot block; this guardrail was not written" });
        continue;
      }
      const any = hook.matcher === undefined || hook.matcher === "" || hook.matcher === "*";
      let matcher: string | undefined;
      const reasons = spec.reason ? [spec.reason] : [];
      if (spec.matcher === "type" && !any) matcher = hook.matcher;
      if (spec.matcher === "tool") {
        const m = any ? { matcher: undefined, reasons: [REASON_STAR] } : mapMatcher(hook.matcher);
        if ("blocked" in m) {
          items.push(hookStatus(hook, "Cursor", `cannot map the matcher token \`${m.blocked}\``));
          continue;
        }
        matcher = any ? undefined : m.matcher;
        reasons.push(...m.reasons);
      }
      const bucket = eventEntries[spec.cursor] ?? [];
      eventEntries[spec.cursor] = bucket;
      emit(hook, bucket, matcher, hook.event);
      items.push({
        phase: "export",
        kind: "hook",
        name: hook.event,
        status: reasons.length > 0 ? "lossy" : "exact",
        reason: [...reasons, REASON_NODE, REASON_TWICE].join("; "),
      });
      continue;
    }
    const mapped = mapMatcher(hook.matcher);
    if ("blocked" in mapped) {
      items.push(hookStatus(hook, "Cursor", `cannot map the matcher token \`${mapped.blocked}\``));
      continue;
    }
    const tokens = hook.matcher ? hook.matcher.split("|") : [];
    const hasRead = tokens.includes("Read");
    const restTokens = tokens.filter((t) => t !== "Read");
    const rest = (hasRead ? mapMatcher(restTokens.join("|")) : mapped) as { matcher: string; reasons: string[] };
    if (!hasRead || restTokens.length > 0) {
      const isShell = rest.matcher === "Shell";
      emit(hook, isShell ? shellEntries : entries, isShell ? undefined : rest.matcher);
    }
    if (hasRead) {
      emit(hook, readEntries);
      emitRecorder(hook);
    }
    const reasons = [
      ...rest.reasons,
      ...(hasRead ? [REASON_READ] : []),
    ];
    items.push({
      phase: "export",
      kind: "hook",
      name: hook.event,
      status: reasons.length > 0 ? "lossy" : "exact",
      reason: [...reasons, REASON_NODE, REASON_TWICE].join("; "),
    });
  }
  const formatters = writableFormatters(config);
  items.push(...config.formatters.filter((f) => !formatters.includes(f)).map(formatterItem));
  if (written === 0 && formatters.length === 0 && !logModel) return { files, items };

  const stale = (fs.existsSync(hooksDir) ? fs.readdirSync(hooksDir) : []).filter((f) => {
    const m = /^harnessport-guard-(\d+)\.mjs$/.exec(f);
    return m !== null && Number(m[1]) > written;
  });
  if (stale.length > 0 && ctx.force) {
    if (!ctx.dryRun) {
      for (const file of stale) fs.unlinkSync(path.join(hooksDir, file));
    }
  } else if (stale.length > 0) {
    const last = items.filter((i) => (i.status === "exact" || i.status === "lossy")).at(-1);
    if (last) {
      last.reason = [
        last.reason,
        `stale wrapper files remain and are not referenced: ${stale.join(", ")}`,
      ].filter(Boolean).join("; ");
    }
  }

  const formatEntries: Array<Record<string, unknown>> = [];
  let runnerWritten = true;
  if (formatters.length > 0) {
    const runner = path.join(rootDir, FORMAT_RUNNER_REL);
    runnerWritten = writeIfNotDry(runner, formatRunnerSource("file_path"), ctx);
    if (runnerWritten) files.push(runner);
    const runnerArg = userLevel ? `"${runner}"` : FORMAT_RUNNER_REL;
    for (const fmt of formatters) {
      formatEntries.push({ command: `node ${runnerArg} "${fmt.glob}" ${fmt.command}` });
    }
  }

  if (logModel) {
    const wrapper = path.join(rootDir, MODEL_LOG_REL);
    if (writeIfNotDry(wrapper, modelLogSource(), ctx)) files.push(wrapper);
    eventEntries.stop = [
      ...(eventEntries.stop ?? []),
      { command: userLevel ? `node "${wrapper}"` : `node ${MODEL_LOG_REL}` },
    ];
    items.push({ phase: "export", kind: "hook", name: "model-log", status: "exact" });
  }

  const filePath = path.join(rootDir, ".cursor", "hooks.json");
  const json = {
    version: 1,
    hooks: {
      ...(entries.length > 0 && { preToolUse: entries }),
      ...(shellEntries.length > 0 && { beforeShellExecution: shellEntries }),
      ...(readEntries.length > 0 && { beforeReadFile: readEntries }),
      ...eventEntries,
      ...(formatEntries.length > 0 && { afterFileEdit: formatEntries }),
    },
  };
  const hooksWritten = writeIfNotDry(filePath, `${JSON.stringify(json, null, 2)}\n`, ctx);
  if (hooksWritten) files.push(filePath);
  else {
    for (const item of items) {
      if ((item.kind === "hook" || item.kind === "permission") && (item.status === "exact" || item.status === "lossy")) {
        item.status = "blocked";
        item.reason = REASON_GUARD_REFUSED;
      }
    }
  }
  const formatted = hooksWritten && runnerWritten;
  items.push(
    ...formatters.map((fmt): FidelityItem =>
      formatted
        ? { ...formatterItem(fmt), status: "lossy", reason: REASON_FORMAT_TWICE }
        : { ...formatterItem(fmt), status: "blocked", reason: REASON_HOOKS_REFUSED },
    ),
  );
  return { files, items };
}

// --- Permissions ---

const CLI_JSON_REL = ".cursor/cli.json";
const CLI_CONFIG_REL = ".cursor/cli-config.json";
const REASON_DENY_UNVERIFIED = (tool: string): string =>
  `Cursor's \`${tool}\` matching is not verified to be no narrower than this deny, so the rule was not written`;
const REASON_BASE_DENY = "the deny covers every command with the same first token, not only this pattern";
const REASON_CLI_REFUSED = "the Cursor permission file already exists with different content; this rule was not written";

type CursorRule = { list: "allow" | "deny"; rule: string; item: FidelityItem };

type CursorPermissionFile = Record<string, unknown> & {
  permissions?: { allow?: unknown; deny?: unknown };
};

function isCursorPermissionFile(value: unknown): value is CursorPermissionFile {
  return typeof value === "object" && value !== null;
}

function bashRule(pattern: string): { rule: string; exact: boolean } | undefined {
  if (pattern === "*") return { rule: "Shell(*)", exact: true };
  const space = pattern.indexOf(" ");
  if (space > 0) {
    return {
      rule: `Shell(${pattern.slice(0, space)}:${pattern.slice(space + 1)})`,
      exact: true,
    };
  }
  if (/^[^\s:]+:\S+$/.test(pattern)) {
    const colon = pattern.indexOf(":");
    return {
      rule: `Shell(${pattern.slice(0, colon)}:${pattern.slice(colon + 1)})`,
      exact: true,
    };
  }
  return pattern !== "" ? { rule: `Shell(${pattern})`, exact: false } : undefined;
}

/** The Cursor rule for one entry, or the item that says why none is written. */
function mapPermission(p: PermissionEntry): CursorRule | FidelityItem | undefined {
  const name = `${p.tool}(${p.pattern})`;
  if (p.action === "ask" && p.pattern === "*" && parseClaudeMcpTool(p.tool)) {
    return undefined; // exportHooks writes the native beforeMCPExecution guard.
  }
  if (p.action === "ask") {
    return permissionStatus(p, NO_PERMISSIONS, "Cursor", "has no per-token ask entry");
  }

  const list = p.action;
  const mcp = parseClaudeMcpTool(p.tool);
  if (mcp && p.pattern === "*") {
    return {
      list,
      rule: `Mcp(${mcp.server}:${mcp.tool})`,
      item: { phase: "export", kind: "permission", name, status: "exact" },
    };
  }

  const documentedTool = {
    read: "Read",
    write: "Write",
    webfetch: "WebFetch",
  }[p.tool.toLowerCase()];
  if (documentedTool && p.pattern !== "") {
    return {
      list,
      rule: `${documentedTool}(${p.pattern})`,
      item: { phase: "export", kind: "permission", name, status: "exact" },
    };
  }

  if (p.tool.toLowerCase() === "bash") {
    const mapped = bashRule(p.pattern);
    if (mapped?.exact) {
      return {
        list,
        rule: mapped.rule,
        item: { phase: "export", kind: "permission", name, status: "exact" },
      };
    }
    if (mapped && p.action === "deny") {
      return {
        list,
        rule: mapped.rule,
        item: {
          phase: "export",
          kind: "permission",
          name,
          status: "lossy",
          reason: REASON_BASE_DENY,
        },
      };
    }
  }

  if (p.action === "deny") {
    return {
      phase: "export",
      kind: "permission",
      name,
      status: "blocked",
      reason: REASON_DENY_UNVERIFIED(p.tool),
    };
  }
  return permissionStatus(
    p,
    NO_PERMISSIONS,
    "Cursor",
    "has no documented permission token for this Claude tool or pattern",
  );
}

function cursorPermissionPath(rootDir: string, userLevel: boolean): string {
  return path.join(rootDir, userLevel ? CLI_CONFIG_REL : CLI_JSON_REL);
}

function parseCursorPermission(
  token: string,
  action: PermissionEntry["action"],
): PermissionEntry | undefined {
  const match = /^(\w+)\((.*)\)$/.exec(token);
  if (!match) return undefined;
  const [, tool, value] = match;
  if (tool === "Shell") {
    if (value === "*") return { tool: "Bash", pattern: "*", action };
    const colon = value.indexOf(":");
    return {
      tool: "Bash",
      pattern: colon < 0
        ? `${value} *`
        : `${value.slice(0, colon)} ${value.slice(colon + 1)}`,
      action,
    };
  }
  if (tool === "Mcp") {
    const colon = value.indexOf(":");
    if (colon < 1 || colon === value.length - 1) return undefined;
    return {
      tool: `mcp__${value.slice(0, colon)}__${value.slice(colon + 1)}`,
      pattern: "*",
      action,
    };
  }
  if (["Read", "Write", "WebFetch"].includes(tool)) {
    return { tool, pattern: value, action };
  }
  return undefined;
}

function importPermissions(
  rootDir: string,
  userLevel: boolean,
): { permissions: PermissionEntry[]; items: FidelityItem[] } {
  const filePath = cursorPermissionPath(rootDir, userLevel);
  const json = readJsonAs(filePath, isCursorPermissionFile);
  const permissions: PermissionEntry[] = [];
  const items: FidelityItem[] = [];
  for (const action of ["allow", "deny"] as const) {
    const tokens = json?.permissions?.[action];
    if (!Array.isArray(tokens)) continue;
    for (const token of tokens) {
      if (typeof token !== "string") continue;
      const parsed = parseCursorPermission(token, action);
      if (parsed) permissions.push(parsed);
      else {
        items.push({
          phase: "import",
          kind: "permission",
          name: token,
          status: "dropped",
          reason: "the Cursor permission token has no verified Claude mapping",
        });
      }
    }
  }
  return { permissions, items };
}

function exportPermissions(
  rootDir: string,
  permissions: PermissionEntry[],
  ctx: WriteContext,
  userLevel: boolean,
): { files: string[]; items: FidelityItem[] } {
  const mapped = permissions.map(mapPermission).filter((m): m is CursorRule | FidelityItem => m !== undefined);
  const rules = mapped.filter((m): m is CursorRule => "list" in m);
  const items = mapped.map((m) => ("list" in m ? m.item : m));
  if (permissions.length === 0) return { files: [], items };

  const pick = (list: CursorRule["list"]): string[] => [...new Set(rules.filter((r) => r.list === list).map((r) => r.rule))];
  const filePath = cursorPermissionPath(rootDir, userLevel);
  let base: CursorPermissionFile = {};
  if (userLevel && fs.existsSync(filePath)) {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      if (!isCursorPermissionFile(parsed)) throw new Error("root is not an object");
      base = parsed;
    } catch (error) {
      return {
        files: [],
        items: [
          ...items,
          {
            phase: "export",
            kind: "permission",
            name: filePath,
            status: "blocked",
            reason: `the existing Cursor user config is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
  const json = {
    ...base,
    ...(userLevel && { version: typeof base.version === "number" ? base.version : 1 }),
    ...(userLevel && { editor: base.editor ?? { vimMode: false } }),
    permissions: { allow: pick("allow"), deny: pick("deny") },
  };
  if (writeIfNotDry(filePath, `${JSON.stringify(json, null, 2)}\n`, ctx)) return { files: [filePath], items };
  return {
    files: [],
    items: mapped.map((m) =>
      "list" in m
        ? { ...m.item, status: m.list === "deny" ? "blocked" : "dropped", reason: REASON_CLI_REFUSED }
        : m,
    ),
  };
}

function cursorAgentItems(agents: Agent[]): FidelityItem[] {
  return agents.map((agent) => {
    const lost = [
      ...(agent.skills?.length ? ["skills"] : []),
      ...(agent.tools?.length ? ["tools"] : []),
      ...(agent.mode !== undefined ? ["mode"] : []),
      ...(agent.temperature !== undefined ? ["temperature"] : []),
      ...(agent.permissions !== undefined ? ["permissions"] : []),
    ];
    return {
      phase: "export",
      kind: "agent",
      name: agent.name,
      status: lost.length ? "lossy" : "exact",
      ...(lost.length && { reason: `Cursor agent files cannot hold: ${lost.join(", ")}` }),
    };
  });
}

function cursorCommandItems(commands: Command[]): FidelityItem[] {
  return commands.map((command) => {
    const lost = [
      ...(command.description !== undefined ? ["description"] : []),
      ...(command.allowedTools?.length ? ["allowedTools"] : []),
      ...(command.agent !== undefined ? ["agent"] : []),
    ];
    return {
      phase: "export",
      kind: "command",
      name: command.name,
      status: lost.length ? "lossy" : "exact",
      ...(lost.length && { reason: `Cursor command files cannot hold: ${lost.join(", ")}` }),
    };
  });
}

function cursorMcpItems(servers: HarnessConfig["mcpServers"]): FidelityItem[] {
  return servers.map((server) => ({
    phase: "export",
    kind: "mcp",
    name: server.name,
    status: server.enabled === undefined ? "exact" : "lossy",
    ...(server.enabled !== undefined && {
      reason: "Cursor stores enabled state outside mcp.json",
    }),
  }));
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
    permission: "full",
    hook: "full",
    formatter: "full",
  },
  permissionActions: ALL_ACTIONS,

  detect(rootDir: string): boolean {
    const cursorDir = path.join(rootDir, ".cursor");
    return (
      fs.existsSync(path.join(cursorDir, "rules")) ||
      fs.existsSync(path.join(cursorDir, "commands")) ||
      fs.existsSync(path.join(cursorDir, "agents")) ||
      fs.existsSync(path.join(cursorDir, "skills")) ||
      fs.existsSync(path.join(cursorDir, "mcp.json")) ||
      fs.existsSync(path.join(cursorDir, "hooks.json")) ||
      fs.existsSync(path.join(cursorDir, "cli.json")) ||
      fs.existsSync(path.join(rootDir, CLI_CONFIG_REL)) ||
      fs.existsSync(path.join(rootDir, ".cursorrules"))
    );
  },

  import(rootDir: string): HarnessConfig {
    const cursorDir = path.join(rootDir, ".cursor");
    const formatterImport = importFormatters(rootDir);
    const userLevel = path.resolve(rootDir) === path.resolve(os.homedir());
    const permissionImport = importPermissions(rootDir, userLevel);
    const hookImport = importHooks(rootDir);
    return {
      rules: importRules(rootDir),
      agents: importAgents(rootDir),
      skills: importSkillsFromDir(path.join(cursorDir, "skills")),
      commands: importCommands(rootDir),
      mcpServers: importMcpFromJson(path.join(cursorDir, "mcp.json")),
      permissions: [...permissionImport.permissions, ...hookImport.permissions],
      hooks: hookImport.hooks,
      formatters: formatterImport.formatters,
      items: [
        ...takeReadProblems(),
        ...formatterImport.items,
        ...permissionImport.items,
        ...hookImport.items,
      ],
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
    const userLevel = path.resolve(rootDir) === path.resolve(homeDir);
    const hookExport = exportHooks(rootDir, config, ctx, userLevel, options.logModel);
    const permissionExport = exportPermissions(rootDir, config.permissions, ctx, userLevel);
    const filesWritten: string[] = [
      ...hookExport.files,
      ...permissionExport.files,
      ...exportRules(rootDir, config, ctx),
      ...exportCommands(rootDir, config.commands, ctx),
      ...exportAgents(rootDir, config.agents, ctx),
      ...exportSkillsToDir(path.join(cursorDir, "skills"), config.skills, ctx),
      ...exportMcpToJson(path.join(cursorDir, "mcp.json"), config.mcpServers, ctx),
    ];

    items.push(
      ...generateDropItems(config, { targetName: "Cursor" }),
      ...exactItems("rule", config.rules.map((r) => r.source ?? "project-rules")),
      ...cursorAgentItems(config.agents),
      ...exactItems("skill", config.skills.map((s) => s.name)),
      ...cursorCommandItems(config.commands),
      ...cursorMcpItems(config.mcpServers),
      ...permissionExport.items,
    );

    items.push(...hookExport.items, ...ctx.items);
    return { filesWritten, items };
  },
};

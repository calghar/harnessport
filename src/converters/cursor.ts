import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import type { Converter, ExportOptions, ExportResult } from "./types.js";
import { NO_PERMISSIONS } from "./types.js";
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
  'import { readFileSync } from "node:fs";',
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
  "function main() {",
  "  let input;",
  "  try { input = JSON.parse(readFileSync(0, \"utf-8\")); } catch (e) { return end(1, \"harnessport-guard: stdin is not JSON\"); }",
  "  if (input && input.tool_name === \"Shell\") input.tool_name = \"Bash\";",
  "  if (HOOK.event) return relay(input);",
  "  const shellEvent = !!input && (input.hook_event_name === \"beforeShellExecution\" || (input.tool_name === undefined && typeof input.command === \"string\"));",
  "  if (shellEvent) input = { ...input, tool_name: \"Bash\", tool_input: { command: input.command, working_directory: input.cwd } };",
  "  const lines = (s) => { const n = s.split(\"\\n\").length; return s.endsWith(\"\\n\") ? n - 1 : n; };",
  "  const readEvent = !!input && (input.hook_event_name === \"beforeReadFile\" || (input.tool_name === undefined && typeof input.file_path === \"string\" && typeof input.content === \"string\"));",
  "  if (readEvent) {",
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

const wrapperSource = (hook: Hook, event?: string): string =>
  `const HOOK = ${JSON.stringify({ command: hook.command, ...(hook.args && { args: hook.args }), ...(event && { event }) })};\n${WRAPPER_TEMPLATE}`;

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
const REASON_READ =
  "the Read range is recovered from the content line count, unverified in Cursor";
const REASON_STAR = "Cursor tool names other than `Shell` reach the script unrenamed";
const REASON_HOOKS_REFUSED =
  "`.cursor/hooks.json` or the formatter runner already exists with different content; this formatter was not written";
const REASON_GUARD_REFUSED = "`.cursor/hooks.json` already exists with different content; this guardrail was not written";
const REASON_FORMAT_TWICE =
  "the formatter runs twice when `.claude/settings.json` also holds it and Third-Party Imports is on";
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
  SubagentStart: { cursor: "subagentStart", matcher: "type", status: "exact" },
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
): { files: string[]; items: FidelityItem[] } {
  const items: FidelityItem[] = [];
  const files: string[] = [];
  const entries: Array<Record<string, unknown>> = [];
  const shellEntries: Array<Record<string, unknown>> = [];
  const hooksDir = path.join(rootDir, ".cursor", "hooks");
  const readEntries: Array<Record<string, unknown>> = [];
  const eventEntries: Record<string, Array<Record<string, unknown>>> = {};
  let written = 0;
  const emit = (hook: Hook, target: Array<Record<string, unknown>>, matcher?: string, event?: string): void => {
    written += 1;
    const wrapper = path.join(hooksDir, `harnessport-guard-${written}.mjs`);
    if (writeIfNotDry(wrapper, wrapperSource(hook, event), ctx)) files.push(wrapper);
    target.push({
      command: userLevel ? `node "${wrapper}"` : `node ${path.relative(rootDir, wrapper)}`,
      ...(matcher && { matcher }),
      ...(hook.timeout !== undefined && { timeout: hook.timeout }),
      ...(hook.failClosed && { failClosed: true }),
    });
  };

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
    if (hasRead) emit(hook, readEntries);
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
  if (written === 0 && formatters.length === 0) return { files, items };

  const stale = (fs.existsSync(hooksDir) ? fs.readdirSync(hooksDir) : []).filter((f) => {
    const m = /^harnessport-guard-(\d+)\.mjs$/.exec(f);
    return m !== null && Number(m[1]) > written;
  });
  if (stale.length > 0) {
    const last = items.filter((i) => (i.status === "exact" || i.status === "lossy")).at(-1);
    if (last) last.reason += `; stale wrapper files remain and are not referenced: ${stale.join(", ")}`;
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
      if (item.kind === "hook" && (item.status === "exact" || item.status === "lossy")) {
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
const REASON_USER_LEVEL = "keeps user-level permissions in `~/.cursor/cli-config.json`, which harnessport never writes";
const REASON_DENY_UNVERIFIED = (tool: string): string =>
  `Cursor's \`${tool}\` matching is not verified to be no narrower than this deny, so the rule was not written`;
const REASON_BASE_DENY = "the deny covers every command with the same first token, not only this pattern";
const REASON_CLI_REFUSED = "`.cursor/cli.json` already exists with different content; this rule was not written";

type CursorRule = { list: "allow" | "deny"; rule: string; item: FidelityItem };

/** The Cursor rule for one entry, or the item that says why none is written (D2). */
function mapPermission(p: PermissionEntry): CursorRule | FidelityItem {
  const name = `${p.tool}(${p.pattern})`;
  const base = p.pattern.split(/\s+/)[0];
  if (p.tool === "Bash" && p.action === "allow" && p.pattern === "*") {
    return { list: "allow", rule: "Shell(*)", item: { phase: "export", kind: "permission", name, status: "exact" } };
  }
  if (p.tool === "Bash" && p.action === "deny" && base !== "") {
    const exact = p.pattern === "*";
    return {
      list: "deny",
      rule: exact ? "Shell(*)" : `Shell(${base})`,
      item: { phase: "export", kind: "permission", name, status: exact ? "exact" : "lossy", ...(exact ? {} : { reason: REASON_BASE_DENY }) },
    };
  }
  if (p.action === "deny") {
    return { phase: "export", kind: "permission", name, status: "blocked", reason: REASON_DENY_UNVERIFIED(p.tool) };
  }
  return permissionStatus(p, NO_PERMISSIONS, "Cursor", "writes only `Shell(*)` allow rules and deny rules");
}

function exportPermissions(
  rootDir: string,
  permissions: PermissionEntry[],
  ctx: WriteContext,
  userLevel: boolean,
): { files: string[]; items: FidelityItem[] } {
  if (userLevel) {
    return {
      files: [],
      items: permissions.map((p) => permissionStatus(p, NO_PERMISSIONS, "Cursor", REASON_USER_LEVEL)),
    };
  }
  const mapped = permissions.map(mapPermission);
  const rules = mapped.filter((m): m is CursorRule => "list" in m);
  const items = mapped.map((m) => ("list" in m ? m.item : m));
  if (rules.length === 0) return { files: [], items };

  const pick = (list: CursorRule["list"]): string[] => [...new Set(rules.filter((r) => r.list === list).map((r) => r.rule))];
  const filePath = path.join(rootDir, CLI_JSON_REL);
  const json = { permissions: { allow: pick("allow"), deny: pick("deny") } };
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
    formatter: "full",
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
    const formatterImport = importFormatters(rootDir);
    return {
      rules: importRules(rootDir),
      agents: importAgents(rootDir),
      skills: importSkillsFromDir(path.join(cursorDir, "skills")),
      commands: importCommands(rootDir),
      mcpServers: importMcpFromJson(path.join(cursorDir, "mcp.json")),
      permissions: [],
      hooks: [],
      formatters: formatterImport.formatters,
      items: [...takeReadProblems(), ...formatterImport.items],
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
    const hookExport = exportHooks(rootDir, config, ctx, userLevel);
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
      ...exactItems("agent", config.agents.map((a) => a.name)),
      ...exactItems("skill", config.skills.map((s) => s.name)),
      ...exactItems("command", config.commands.map((c) => c.name)),
      ...exactItems("mcp", config.mcpServers.map((s) => s.name)),
      ...permissionExport.items,
    );

    items.push(...hookExport.items, ...ctx.items);
    return { filesWritten, items };
  },
};

import * as path from "node:path";
import * as fs from "node:fs";
import type { Converter, ExportOptions, ExportResult } from "./types.js";
import { NO_PERMISSIONS } from "./types.js";
import type {
  HarnessConfig,
  Rule,
  FidelityItem,
  Hook,
} from "../schema.js";
import type { WriteContext } from "../utils.js";
import {
  readFileIfExists,
  readJsonIfExists,
  importSkillsFromDir,
  exportSkillsToDir,
  exportRulesToFile,
  generateDropItems,
  exactItems,
  permissionStatus,
  writeIfNotDry,
  takeReadProblems,
  newWriteContext,
} from "../utils.js";

// --- Import ---

function importRules(rootDir: string): Rule[] {
  const agentsMd = readFileIfExists(path.join(rootDir, "AGENTS.md"));
  if (!agentsMd) return [];
  return [{ content: agentsMd, source: "AGENTS.md", alwaysApply: true }];
}

function importHooks(rootDir: string): Hook[] {
  const hooksJson = readJsonIfExists(path.join(rootDir, ".codex", "hooks.json"));
  if (!hooksJson || typeof hooksJson !== "object") return [];
  return parseCodexHooksObject(hooksJson as Record<string, unknown>);
}

function parseCodexHooksObject(obj: Record<string, unknown>): Hook[] {
  // Codex hooks shape: { "PreToolUse": [ { matcher: "...", hooks: [ { type: "command", command: "..." } ] } ], ... }
  // Also supports: { "hooks": { ... } } wrapper
  const hooksRoot = (typeof obj.hooks === "object" && obj.hooks !== null && !Array.isArray(obj.hooks))
    ? obj.hooks as Record<string, unknown>
    : obj;

  return Object.entries(hooksRoot)
    .filter(([event, groups]) => event !== "hooks" && Array.isArray(groups))
    .flatMap(([event, groups]) =>
      (groups as unknown[])
        .filter((g): g is Record<string, unknown> => typeof g === "object" && g !== null)
        .flatMap((g) => {
          const matcher = typeof g.matcher === "string" ? g.matcher : undefined;
          const handlers = Array.isArray(g.hooks) ? g.hooks : [];
          return handlers
            .filter((h): h is Record<string, unknown> => typeof h === "object" && h !== null)
            .filter((h) => typeof h.command === "string")
            .map((h) => ({ event, matcher, command: h.command as string }));
        }),
    );
}

// --- Export ---

function exportHooks(
  rootDir: string,
  hooks: Hook[],
  ctx: WriteContext,
): string[] {
  if (hooks.length === 0) return [];

  // Group hooks into Codex format: { "Event": [ { matcher?: "...", hooks: [ ... ] } ] }
  const grouped = hooks.reduce<Record<string, Array<{ matcher?: string; hooks: Array<{ type: string; command: string }> }>>>((acc, hook) => {
    if (!acc[hook.event]) acc[hook.event] = [];
    const matcherKey = hook.matcher ?? "";
    let group = acc[hook.event].find((g) => (g.matcher ?? "") === matcherKey);
    if (!group) {
      group = { hooks: [], ...(hook.matcher ? { matcher: hook.matcher } : {}) };
      acc[hook.event].push(group);
    }
    group.hooks.push({ type: "command", command: hook.command });
    return acc;
  }, {});

  const filePath = path.join(rootDir, ".codex", "hooks.json");
  if (!writeIfNotDry(filePath, `${JSON.stringify({ hooks: grouped }, null, 2)}\n`, ctx)) return [];
  return [filePath];
}

// --- Converter ---

export const codexConverter: Converter = {
  name: "codex",
  label: "Codex CLI",
  // Agents and MCP servers live in ~/.codex/config.toml, which is user-level and not read.
  // Permissions are `none`, not user-level: Codex has approval_policy and sandbox_mode, which are
  // a sandbox mode rather than a tool-and-pattern list, so a PermissionEntry has nothing to map
  // onto — the feature is absent, not merely out of reach.
  capabilities: {
    rule: "full",
    agent: "user-level",
    skill: "full",
    command: "none",
    mcp: "user-level",
    permission: "none",
    hook: "full",
    formatter: "none",
  },
  permissionActions: NO_PERMISSIONS,

  detect(rootDir: string): boolean {
    return fs.existsSync(path.join(rootDir, ".codex"));
  },

  import(rootDir: string): HarnessConfig {
    return {
      rules: importRules(rootDir),
      agents: [],
      skills: importSkillsFromDir(path.join(rootDir, ".codex", "skills")),
      commands: [],
      mcpServers: [],
      permissions: [],
      hooks: importHooks(rootDir),
      formatters: [],
      items: [
        ...takeReadProblems(),
        {
          phase: "import",
          kind: "mcp",
          name: "(all)",
          status: "dropped",
          reason:
            "Codex CLI MCP servers live in ~/.codex/config.toml (user-level TOML), which is not read",
        },
        {
          phase: "import",
          kind: "agent",
          name: "(all)",
          status: "dropped",
          reason:
            "Codex CLI agents live in ~/.codex/config.toml (user-level TOML), which is not read",
        },
      ],
    };
  },

  export(
    rootDir: string,
    config: HarnessConfig,
    options: ExportOptions = {},
  ): ExportResult {
    const ctx = newWriteContext(options);
    const items: FidelityItem[] = [...config.items];
    const filesWritten: string[] = [
      ...exportRulesToFile(
        path.join(rootDir, "AGENTS.md"),
        config.rules,
        ctx,
      ),
      ...exportSkillsToDir(
        path.join(rootDir, ".codex", "skills"),
        config.skills,
        ctx,
      ),
      ...exportHooks(rootDir, config.hooks, ctx),
    ];

    items.push(
      ...generateDropItems(config, {
        // This exporter writes config.rules only. Claiming agent bodies were "merged into
        // AGENTS.md" was false; they are reported dropped.
        agents:
          "Codex CLI agents are configured in ~/.codex/config.toml [agents.<name>], and this exporter does not write agent bodies into AGENTS.md",
        commands: "Codex CLI has built-in slash commands, not user-defined ones",
        mcpServers:
          "Codex CLI MCP is configured in ~/.codex/config.toml [mcp_servers.<name>] (user-level TOML)",
      }),
      ...exactItems("rule", config.rules.map((r) => r.source ?? "project-rules")),
      ...exactItems("skill", config.skills.map((s) => s.name)),
      ...exactItems("hook", config.hooks.map((h) => h.event)),
      ...config.permissions.map((p) =>
        permissionStatus(p, codexConverter.permissionActions, "Codex CLI"),
      ),
    );

    for (const fmt of config.formatters) {
      items.push({
        phase: "export",
        kind: "formatter",
        name: fmt.glob,
        status: "dropped",
        reason: "Codex CLI has no formatter equivalent",
      });
    }

    items.push(...ctx.items);
    return { filesWritten, items };
  },
};

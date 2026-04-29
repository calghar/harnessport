import * as path from "node:path";
import * as fs from "node:fs";
import type { Converter, ExportResult } from "./types.js";
import type {
  HarnessConfig,
  Rule,
  Hook,
} from "../schema.js";
import {
  readFileIfExists,
  readJsonIfExists,
  importSkillsFromDir,
  exportSkillsToDir,
  exportRulesToFile,
  generateDropWarnings,
  writeIfNotDry,
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
  dryRun: boolean,
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
  writeIfNotDry(filePath, `${JSON.stringify({ hooks: grouped }, null, 2)}\n`, dryRun);
  return [filePath];
}

// --- Converter ---

export const codexConverter: Converter = {
  name: "codex",

  detect(rootDir: string): boolean {
    return fs.existsSync(path.join(rootDir, ".codex"));
  },

  import(rootDir: string): HarnessConfig {
    const warnings: string[] = [];
    warnings.push(
      "Codex CLI MCP servers and agents are configured in ~/.codex/config.toml (user-level TOML), not project-level files. These were not imported.",
    );
    return {
      rules: importRules(rootDir),
      agents: [],
      skills: importSkillsFromDir(path.join(rootDir, ".codex", "skills")),
      commands: [],
      mcpServers: [],
      permissions: [],
      hooks: importHooks(rootDir),
      formatters: [],
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
      ...exportSkillsToDir(
        path.join(rootDir, ".codex", "skills"),
        config.skills,
        dryRun,
      ),
      ...exportHooks(rootDir, config.hooks, dryRun),
    ];

    warnings.push(...generateDropWarnings(config, {
      agents: "partially converted. Codex CLI agents are configured in ~/.codex/config.toml [agents.<name>], not project files. Agent body content was merged into AGENTS.md.",
      commands: "dropped. Codex CLI has built-in slash commands, not user-defined ones.",
      mcpServers: "not written. Codex CLI MCP is configured in ~/.codex/config.toml [mcp_servers.<name>] (TOML format, user-level).",
      permissions: "Permissions partially map to Codex CLI approval_policy in config.toml. Not written (user-level config).",
    }));

    if (config.formatters.length > 0) {
      warnings.push("Formatters dropped. Codex CLI has no formatter equivalent.");
    }

    return { filesWritten, warnings };
  },
};

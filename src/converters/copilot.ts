import * as path from "node:path";
import * as fs from "node:fs";
import type { Converter, ExportResult } from "./types.js";
import type {
  HarnessConfig,
  Rule,
  Agent,
  Command,
  Hook,
} from "../schema.js";
import {
  parseFrontmatter,
  serializeFrontmatter,
  readFileIfExists,
  getString,
  getStringArray,
  getStringOrFallback,
  importSkillsFromDir,
  exportSkillsToDir,
  importMcpFromJson,
  exportMcpToJson,
  generateDropWarnings,
  writeIfNotDry,
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
      const raw = fs.readFileSync(path.join(instructionsDir, file), "utf-8");
      const { data, content } = parseFrontmatter(raw);
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
  return files.map((filePath) => {
    const raw = fs.readFileSync(filePath, "utf-8");
    const { data, content } = parseFrontmatter(raw);
    const modelVal = data.model;
    let model: string | undefined;
    if (typeof modelVal === "string") model = modelVal;
    else if (Array.isArray(modelVal) && typeof modelVal[0] === "string") model = modelVal[0];

    return {
      name: getStringOrFallback(data, "name", path.basename(filePath, ".agent.md")),
      description: getString(data, "description"),
      model,
      body: content,
      tools: getStringArray(data, "tools"),
    };
  });
}

function importCommands(rootDir: string): Command[] {
  const promptsDir = path.join(rootDir, ".github", "prompts");
  return listMdFiles(promptsDir).map((filePath) => {
    const raw = fs.readFileSync(filePath, "utf-8");
    const { data, content } = parseFrontmatter(raw);
    return {
      name: path.basename(filePath, ".prompt.md"),
      description: getString(data, "description"),
      body: content,
      allowedTools: getStringArray(data, "tools"),
      agent: getString(data, "agent"),
    };
  });
}

function extractCommandFromHandler(handler: unknown): string | undefined {
  if (typeof handler !== "object" || handler === null) return undefined;
  const h = handler as Record<string, unknown>;
  const hookType = typeof h.type === "string" ? h.type : "command";
  if (hookType !== "command") return undefined;
  return typeof h.bash === "string" ? h.bash : (typeof h.command === "string" ? h.command : undefined);
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
    return Object.entries(raw as Record<string, unknown>).flatMap(([event, handlers]) => {
      if (!Array.isArray(handlers)) return [];
      return handlers
        .map((h) => extractCommandFromHandler(h))
        .filter((cmd): cmd is string => cmd !== undefined)
        .map((cmd) => ({ event, command: cmd }));
    });
  });
}

// --- Export ---

function exportRules(
  rootDir: string,
  config: HarnessConfig,
  dryRun: boolean,
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
    writeIfNotDry(filePath, combined, dryRun);
    files.push(filePath);
  }

  const instructionsDir = path.join(rootDir, ".github", "instructions");
  for (const rule of [...globRules, ...descriptionRules]) {
    const baseName = rule.source
      ? slugify(path.basename(rule.source, path.extname(rule.source)))
      : "rule";
    const fileName = `${baseName}.instructions.md`;
    const filePath = path.join(instructionsDir, fileName);

    const frontmatter: Record<string, unknown> = {};
    if (rule.globs) frontmatter.applyTo = rule.globs;

    const content = serializeFrontmatter(frontmatter, rule.content);
    writeIfNotDry(filePath, content, dryRun);
    files.push(filePath);
  }

  return files;
}

function exportAgents(
  rootDir: string,
  agents: Agent[],
  dryRun: boolean,
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
    writeIfNotDry(filePath, content, dryRun);
    files.push(filePath);
  }
  return files;
}

function exportCommands(
  rootDir: string,
  commands: Command[],
  dryRun: boolean,
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
    writeIfNotDry(filePath, content, dryRun);
    files.push(filePath);
  }
  return files;
}

function exportHooks(
  rootDir: string,
  hooks: Hook[],
  dryRun: boolean,
): string[] {
  if (hooks.length === 0) return [];

  // Group hooks by event
  const grouped = hooks.reduce<Record<string, Array<{ type: string; bash: string }>>>((acc, hook) => {
    if (!acc[hook.event]) acc[hook.event] = [];
    acc[hook.event].push({ type: "command", bash: hook.command });
    return acc;
  }, {});

  const filePath = path.join(rootDir, ".github", "hooks", "hooks.json");
  writeIfNotDry(filePath, `${JSON.stringify(grouped, null, 2)}\n`, dryRun);
  return [filePath];
}

export const copilotConverter: Converter = {
  name: "copilot",

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
    const warnings: string[] = [];
    return {
      rules: importRules(rootDir),
      agents: importAgents(rootDir),
      skills: importSkillsFromDir(path.join(rootDir, ".github", "skills")),
      commands: importCommands(rootDir),
      mcpServers: importMcpFromJson(path.join(rootDir, ".copilot", "mcp-config.json")),
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
      ...exportRules(rootDir, config, dryRun),
      ...exportAgents(rootDir, config.agents, dryRun),
      ...exportSkillsToDir(
        path.join(rootDir, ".github", "skills"),
        config.skills,
        dryRun,
      ),
      ...exportCommands(rootDir, config.commands, dryRun),
      ...exportMcpToJson(
        path.join(rootDir, ".copilot", "mcp-config.json"),
        config.mcpServers,
        dryRun,
      ),
      ...exportHooks(rootDir, config.hooks, dryRun),
    ];

    warnings.push(...generateDropWarnings(config, {
      permissions: "Permissions dropped. Copilot has no project-level permission config.",
    }));

    // Formatters don't have a direct equivalent in Copilot
    if (config.formatters.length > 0) {
      warnings.push(
        "Formatters dropped. Copilot hooks can run scripts on tool use events, but formatters were exported as hooks instead.",
      );
    }

    return { filesWritten, warnings };
  },
};

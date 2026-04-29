import * as path from "node:path";
import * as fs from "node:fs";
import type { Converter, ExportResult } from "./types.js";
import type {
  HarnessConfig,
  Rule,
  Agent,
  Command,
} from "../schema.js";
import {
  parseFrontmatter,
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
  generateDropWarnings,
  writeIfNotDry,
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
      const raw = fs.readFileSync(path.join(rulesDir, file), "utf-8");
      const { data, content } = parseFrontmatter(raw);
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
  return listMdFiles(agentsDir).map((filePath) => {
    const raw = fs.readFileSync(filePath, "utf-8");
    const { data, content } = parseFrontmatter(raw);
    return {
      name: getStringOrFallback(data, "name", path.basename(filePath, ".md")),
      description: getString(data, "description"),
      model: getString(data, "model"),
      body: content,
    };
  });
}

// --- Export ---

function exportRules(
  rootDir: string,
  config: HarnessConfig,
  dryRun: boolean,
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
  const commandsDir = path.join(rootDir, ".cursor", "commands");
  return commands.map((cmd) => {
    const fileName = `${slugify(cmd.name)}.md`;
    const filePath = path.join(commandsDir, fileName);
    // Cursor commands are plain markdown — no frontmatter
    writeIfNotDry(filePath, cmd.body, dryRun);
    return filePath;
  });
}

function exportAgents(
  rootDir: string,
  agents: Agent[],
  dryRun: boolean,
): string[] {
  const agentsDir = path.join(rootDir, ".cursor", "agents");
  return agents.map((agent) => {
    const fileName = `${slugify(agent.name)}.md`;
    const filePath = path.join(agentsDir, fileName);
    const frontmatter: Record<string, unknown> = {
      name: agent.name,
      model: agent.model,
      description: agent.description,
    };
    const content = serializeFrontmatter(frontmatter, agent.body);
    writeIfNotDry(filePath, content, dryRun);
    return filePath;
  });
}

// --- Converter ---

export const cursorConverter: Converter = {
  name: "cursor",

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
      warnings: [],
    };
  },

  export(
    rootDir: string,
    config: HarnessConfig,
    dryRun = false,
  ): ExportResult {
    const cursorDir = path.join(rootDir, ".cursor");
    const warnings: string[] = [...config.warnings];
    const filesWritten: string[] = [
      ...exportRules(rootDir, config, dryRun),
      ...exportCommands(rootDir, config.commands, dryRun),
      ...exportAgents(rootDir, config.agents, dryRun),
      ...exportSkillsToDir(path.join(cursorDir, "skills"), config.skills, dryRun),
      ...exportMcpToJson(path.join(cursorDir, "mcp.json"), config.mcpServers, dryRun),
    ];

    warnings.push(...generateDropWarnings(config, {
      permissions: "Permissions dropped. Cursor has no project-level permission config.",
      hooksFormatters: "Hooks/formatters dropped. Cursor has no hooks or formatter config.",
    }));

    return { filesWritten, warnings };
  },
};

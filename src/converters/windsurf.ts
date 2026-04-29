import * as path from "node:path";
import * as fs from "node:fs";
import type { Converter, ExportResult } from "./types.js";
import type {
  HarnessConfig,
  Rule,
  Command,
} from "../schema.js";
import {
  parseFrontmatter,
  serializeFrontmatter,
  readFileIfExists,
  getString,
  getGlobs,
  importSkillsFromDir,
  exportSkillsToDir,
  generateDropWarnings,
  writeIfNotDry,
  slugify,
  listMdFiles,
} from "../utils.js";

// --- Import ---

function importRules(rootDir: string): Rule[] {
  const rules: Rule[] = [];

  const rulesDir = path.join(rootDir, ".windsurf", "rules");
  try {
    const files = fs.readdirSync(rulesDir).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      const raw = fs.readFileSync(path.join(rulesDir, file), "utf-8");
      const { data, content } = parseFrontmatter(raw);
      const trigger = getString(data, "trigger");
      rules.push({
        content,
        source: file,
        description: getString(data, "description"),
        globs: getGlobs(data),
        alwaysApply: trigger === "always_on" ? true : undefined,
      });
    }
  } catch { /* directory does not exist */
    // no windsurf rules directory
  }

  const agentsMd = readFileIfExists(path.join(rootDir, "AGENTS.md"));
  if (agentsMd) {
    rules.push({ content: agentsMd, source: "AGENTS.md", alwaysApply: true });
  }

  return rules;
}

function importWorkflows(rootDir: string): Command[] {
  const workflowsDir = path.join(rootDir, ".windsurf", "workflows");
  return listMdFiles(workflowsDir).map((filePath) => {
    const raw = fs.readFileSync(filePath, "utf-8");
    const { data, content } = parseFrontmatter(raw);
    return {
      name: path.basename(filePath, ".md"),
      description: getString(data, "description"),
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
  const rulesDir = path.join(rootDir, ".windsurf", "rules");

  for (const rule of config.rules) {
    const fileName = rule.source
      ? `${slugify(path.basename(rule.source, path.extname(rule.source)))}.md`
      : "project-rules.md";
    const filePath = path.join(rulesDir, fileName);

    const trigger = deriveTrigger(rule);
    const frontmatter: Record<string, unknown> = {
      trigger,
      description: rule.description,
      globs: rule.globs,
    };

    const content = serializeFrontmatter(frontmatter, rule.content);
    writeIfNotDry(filePath, content, dryRun);
    files.push(filePath);
  }

  return files;
}

function deriveTrigger(rule: Rule): string {
  if (rule.alwaysApply) return "always_on";
  if (rule.globs) return "glob";
  if (rule.description) return "model_decision";
  return "always_on";
}

function exportWorkflows(
  rootDir: string,
  commands: Command[],
  dryRun: boolean,
): string[] {
  const files: string[] = [];
  const workflowsDir = path.join(rootDir, ".windsurf", "workflows");

  for (const cmd of commands) {
    const fileName = `${slugify(cmd.name)}.md`;
    const filePath = path.join(workflowsDir, fileName);
    const frontmatter: Record<string, unknown> = {
      description: cmd.description,
    };
    const content = serializeFrontmatter(frontmatter, cmd.body);
    writeIfNotDry(filePath, content, dryRun);
    files.push(filePath);
  }

  return files;
}

// --- Converter ---

export const windsurfConverter: Converter = {
  name: "windsurf",

  detect(rootDir: string): boolean {
    return (
      fs.existsSync(path.join(rootDir, ".windsurf", "rules")) ||
      fs.existsSync(path.join(rootDir, ".windsurf", "skills")) ||
      fs.existsSync(path.join(rootDir, ".windsurf", "workflows"))
    );
  },

  import(rootDir: string): HarnessConfig {
    const warnings: string[] = [];
    return {
      rules: importRules(rootDir),
      agents: [],
      skills: importSkillsFromDir(path.join(rootDir, ".windsurf", "skills")),
      commands: importWorkflows(rootDir),
      mcpServers: [],
      permissions: [],
      hooks: [],
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
      ...exportSkillsToDir(
        path.join(rootDir, ".windsurf", "skills"),
        config.skills,
        dryRun,
      ),
      ...exportWorkflows(rootDir, config.commands, dryRun),
    ];

    warnings.push(...generateDropWarnings(config, {
      agents: "partially converted. Agent instructions were merged into rules. Windsurf supports AGENTS.md but not per-agent tool/model config.",
      mcpServers: "not written. Windsurf MCP config is user-level (~/.codeium/windsurf/mcp_config.json), not project-level.",
      permissions: "Permissions dropped. Windsurf has no project-level permission config.",
      hooksFormatters: "Hooks/formatters dropped. Windsurf has no hooks or formatter config.",
    }));

    return { filesWritten, warnings };
  },
};

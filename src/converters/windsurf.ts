import * as path from "node:path";
import * as fs from "node:fs";
import type { Converter, ExportOptions, ExportResult } from "./types.js";
import { NO_PERMISSIONS } from "./types.js";
import type {
  HarnessConfig,
  Rule,
  Command,
  FidelityItem,
} from "../schema.js";
import type { WriteContext } from "../utils.js";
import {
  parseFrontmatter,
  serializeFrontmatter,
  readFileIfExists,
  getString,
  getGlobs,
  importSkillsFromDir,
  exportSkillsToDir,
  generateDropItems,
  exactItems,
  permissionStatus,
  writeIfNotDry,
  takeReadProblems,
  newWriteContext,
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
  ctx: WriteContext,
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
    if (writeIfNotDry(filePath, content, ctx)) files.push(filePath);
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
  ctx: WriteContext,
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
    if (writeIfNotDry(filePath, content, ctx)) files.push(filePath);
  }

  return files;
}

// --- Converter ---

export const windsurfConverter: Converter = {
  name: "windsurf",
  label: "Windsurf",
  // Windsurf does have MCP servers, but only in ~/.codeium/windsurf/mcp_config.json, outside any
  // repository. It has no agent concept at all — hence none rather than user-level.
  capabilities: {
    rule: "full",
    agent: "none",
    skill: "full",
    command: "full",
    mcp: "user-level",
    permission: "none",
    hook: "none",
    formatter: "none",
  },
  permissionActions: NO_PERMISSIONS,

  detect(rootDir: string): boolean {
    return (
      fs.existsSync(path.join(rootDir, ".windsurf", "rules")) ||
      fs.existsSync(path.join(rootDir, ".windsurf", "skills")) ||
      fs.existsSync(path.join(rootDir, ".windsurf", "workflows"))
    );
  },

  import(rootDir: string): HarnessConfig {
    return {
      rules: importRules(rootDir),
      agents: [],
      skills: importSkillsFromDir(path.join(rootDir, ".windsurf", "skills")),
      commands: importWorkflows(rootDir),
      mcpServers: [],
      permissions: [],
      hooks: [],
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
    const filesWritten: string[] = [
      ...exportRules(rootDir, config, ctx),
      ...exportSkillsToDir(
        path.join(rootDir, ".windsurf", "skills"),
        config.skills,
        ctx,
      ),
      ...exportWorkflows(rootDir, config.commands, ctx),
    ];

    items.push(
      ...generateDropItems(config, {
        // Agents are not written anywhere by this exporter. Saying they were "merged into
        // rules" was false; they are reported dropped.
        agents:
          "Windsurf has no agent config, and this exporter does not write agent bodies into rules",
        mcpServers:
          "Windsurf MCP config is user-level (~/.codeium/windsurf/mcp_config.json), not project-level",
        hooksFormatters: "Windsurf has no hooks or formatter config",
      }),
      ...exactItems("rule", config.rules.map((r) => r.source ?? "project-rules")),
      ...exactItems("skill", config.skills.map((s) => s.name)),
      ...exactItems("command", config.commands.map((c) => c.name)),
      ...config.permissions.map((p) =>
        permissionStatus(p, windsurfConverter.permissionActions, "Windsurf"),
      ),
    );

    items.push(...ctx.items);
    return { filesWritten, items };
  },
};

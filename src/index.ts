#!/usr/bin/env node

import { Command } from "commander";
import { claudeConverter } from "./converters/claude.js";
import { opencodeConverter } from "./converters/opencode.js";
import { cursorConverter } from "./converters/cursor.js";
import { windsurfConverter } from "./converters/windsurf.js";
import { copilotConverter } from "./converters/copilot.js";
import { codexConverter } from "./converters/codex.js";
import type { Converter } from "./converters/types.js";

const converters: Record<string, Converter> = {
  claude: claudeConverter,
  opencode: opencodeConverter,
  cursor: cursorConverter,
  windsurf: windsurfConverter,
  copilot: copilotConverter,
  codex: codexConverter,
};

const converterNames = Object.keys(converters).join(", ");

const program = new Command();

program
  .name("harnessport")
  .description(
    "Convert AI coding harness configs between Claude Code, OpenCode, and more",
  )
  .version("0.1.0");

program
  .command("convert")
  .description("Convert harness configuration from one tool to another")
  .requiredOption("--from <tool>", `Source harness (${converterNames})`)
  .requiredOption("--to <tool>", `Target harness (${converterNames})`)
  .option("--source <dir>", "Source directory", ".")
  .option("--target <dir>", "Target directory (defaults to source dir)")
  .option("--dry-run", "Show what would be created without writing files")
  .action(
    (opts: {
      from: string;
      to: string;
      source: string;
      target?: string;
      dryRun?: boolean;
    }) => {
      const fromConverter = converters[opts.from];
      const toConverter = converters[opts.to];

      if (!fromConverter) {
        console.error(
          `Unknown source: "${opts.from}". Available: ${Object.keys(converters).join(", ")}`,
        );
        process.exit(1);
      }
      if (!toConverter) {
        console.error(
          `Unknown target: "${opts.to}". Available: ${Object.keys(converters).join(", ")}`,
        );
        process.exit(1);
      }
      if (opts.from === opts.to) {
        console.error("Source and target must be different.");
        process.exit(1);
      }

      const sourceDir = opts.source;
      const targetDir = opts.target || sourceDir;

      if (!fromConverter.detect(sourceDir)) {
        console.error(
          `No ${opts.from} configuration found in ${sourceDir}`,
        );
        process.exit(1);
      }

      console.log(`Importing from ${opts.from}...`);
      const config = fromConverter.import(sourceDir);

      console.log(
        `  Rules: ${config.rules.length}, Agents: ${config.agents.length}, Skills: ${config.skills.length}`,
      );
      console.log(
        `  Commands: ${config.commands.length}, MCP Servers: ${config.mcpServers.length}`,
      );
      console.log(
        `  Permissions: ${config.permissions.length}, Hooks: ${config.hooks.length}, Formatters: ${config.formatters.length}`,
      );

      const dryRun = opts.dryRun ?? false;
      console.log(
        `\n${dryRun ? "[DRY RUN] " : ""}Exporting to ${opts.to}...`,
      );
      const result = toConverter.export(targetDir, config, dryRun);

      if (result.filesWritten.length > 0) {
        console.log(
          `\n${dryRun ? "Would write" : "Wrote"} ${result.filesWritten.length} file(s):`,
        );
        for (const f of result.filesWritten) {
          console.log(`  ${f}`);
        }
      }

      if (result.warnings.length > 0) {
        console.log("\nWarnings:");
        for (const w of result.warnings) {
          console.log(`  ⚠ ${w}`);
        }
      }

      if (!dryRun) {
        console.log("\nDone!");
      }
    },
  );

program
  .command("detect")
  .description("Auto-detect which harness is configured in a directory")
  .argument("[dir]", "Directory to scan", ".")
  .action((dir: string) => {
    const detected: string[] = [];
    for (const [name, converter] of Object.entries(converters)) {
      if (converter.detect(dir)) {
        detected.push(name);
      }
    }
    if (detected.length === 0) {
      console.log("No harness configuration detected.");
    } else {
      console.log(`Detected: ${detected.join(", ")}`);
    }
  });

program
  .command("list")
  .description("Show feature support matrix across harnesses")
  .action(() => {
    console.log("Feature support matrix:\n");
    console.log(
      "Feature     | Claude | OpenCode | Cursor | Windsurf | Copilot | Codex CLI",
    );
    console.log(
      "------------|--------|----------|--------|----------|---------|----------",
    );
    console.log(
      "Rules       |   ✓    |    ✓     |   ✓    |    ✓     |   ✓     |    ✓     ",
    );
    console.log(
      "Agents      |   ✓    |    ✓     |   -    |    -     |   -     |    ~     ",
    );
    console.log(
      "Skills      |   ✓    |    ✓     |   -    |    ✓     |   -     |    ✓     ",
    );
    console.log(
      "Commands    |   ✓    |    ✓     |   -    |    ~     |   -     |    -     ",
    );
    console.log(
      "MCP Servers |   ✓    |    ✓     |   ✓    |    ~     |   -     |    ~     ",
    );
    console.log(
      "Permissions |   ✓    |    ✓     |   -    |    -     |   -     |    ~     ",
    );
    console.log(
      "Hooks       |   ✓    |    ~     |   -    |    -     |   -     |    ~     ",
    );
    console.log(
      "Formatters  |   ~    |    ✓     |   -    |    -     |   -     |    -     ",
    );
    console.log(
      "\n✓ = supported  ~ = partial/user-level  - = not available",
    );
  });

program.parse();

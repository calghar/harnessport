#!/usr/bin/env node

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import type { FidelityItem, HarnessConfig } from "./schema.js";
import { CONVERTERS as converters, renderCliMatrix } from "./matrix.js";
import { divergences, roundTripLoss, type Lost } from "./compare.js";

const converterNames = Object.keys(converters).join(", ");

/** Read the shipped package version rather than duplicating it here. */
function packageVersion(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const pkg: unknown = JSON.parse(
    fs.readFileSync(path.join(here, "..", "package.json"), "utf-8"),
  );
  return typeof pkg === "object" && pkg !== null && "version" in pkg
    ? String((pkg as { version: unknown }).version)
    : "0.0.0";
}

const program = new Command();

program
  .name("harnessport")
  .description(
    "Convert AI coding harness configs between Claude Code, OpenCode, and more",
  )
  .version(packageVersion());

program
  .command("convert")
  .description("Convert harness configuration from one tool to another")
  .requiredOption("--from <tool>", `Source harness (${converterNames})`)
  .requiredOption("--to <tool>", `Target harness (${converterNames})`)
  .option("--source <dir>", "Source directory", ".")
  .option("--target <dir>", "Target directory (defaults to source dir)")
  .option("--dry-run", "Show what would be created without writing files")
  .option("--json", "Emit the fidelity report as JSON on stdout")
  .option(
    "--force",
    "Overwrite conflicting existing files, keeping a .bak copy of each",
  )
  .action(
    (opts: {
      from: string;
      to: string;
      source: string;
      target?: string;
      dryRun?: boolean;
      json?: boolean;
      force?: boolean;
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

      // Progress goes to stderr so --json leaves stdout parseable.
      const progress = opts.json ? console.error : console.log;

      progress(`Importing from ${opts.from}...`);
      const config = fromConverter.import(sourceDir);

      progress(
        `  Rules: ${config.rules.length}, Agents: ${config.agents.length}, Skills: ${config.skills.length}`,
      );
      progress(
        `  Commands: ${config.commands.length}, MCP Servers: ${config.mcpServers.length}`,
      );
      progress(
        `  Permissions: ${config.permissions.length}, Hooks: ${config.hooks.length}, Formatters: ${config.formatters.length}`,
      );

      const dryRun = opts.dryRun ?? false;
      progress(
        `\n${dryRun ? "[DRY RUN] " : ""}Exporting to ${opts.to}...`,
      );
      const result = toConverter.export(targetDir, config, { dryRun, force: opts.force ?? false });
      const blocked = result.items.filter((i) => i.status === "blocked");

      if (opts.json) {
        console.log(
          JSON.stringify(
            {
              from: opts.from,
              to: opts.to,
              dryRun,
              filesWritten: result.filesWritten,
              items: result.items,
            },
            null,
            2,
          ),
        );
      } else if (result.filesWritten.length > 0) {
        console.log(
          `\n${dryRun ? "Would write" : "Wrote"} ${result.filesWritten.length} file(s):`,
        );
        for (const f of result.filesWritten) {
          console.log(`  ${f}`);
        }
      }

      reportFidelity(result.items, opts.json ?? false);

      if (blocked.length > 0) {
        console.error(
          `\n${blocked.length} item(s) blocked. Nothing was written in a weakened form.`,
        );
        process.exit(2);
      }
      if (!dryRun && !opts.json) {
        console.log("\nDone!");
      }
    },
  );

/** Render the grouped fidelity summary. Goes to stderr under --json so stdout stays parseable. */
function reportFidelity(items: FidelityItem[], jsonMode: boolean): void {
  const out = jsonMode ? console.error : console.log;
  const counts = { exact: 0, lossy: 0, dropped: 0, blocked: 0 };
  for (const i of items) counts[i.status]++;

  if (items.length === 0) return;

  out(
    `\nFidelity: ${counts.exact} exact, ${counts.lossy} lossy, ${counts.dropped} dropped, ${counts.blocked} blocked`,
  );

  for (const status of ["blocked", "lossy", "dropped"] as const) {
    const group = items.filter((i) => i.status === status);
    if (group.length === 0) continue;
    out(`\n  ${status.toUpperCase()}`);
    for (const item of group) {
      out(`    ${item.kind} ${item.name}`);
      if (item.reason) out(`      ${item.reason}`);
    }
  }
}

/** Resolve a harness name, exiting 1 with the available names if it is not one. */
function requireConverter(name: string, role: string) {
  const converter = converters[name];
  if (!converter) {
    console.error(
      `Unknown ${role}: "${name}". Available: ${Object.keys(converters).join(", ")}`,
    );
    process.exit(1);
  }
  return converter;
}

function renderLoss(out: (s: string) => void, label: string, loss: Lost[]): void {
  if (loss.length === 0) return;
  out(`\n  ${label}`);
  for (const entry of loss) out(`    ${entry.kind} ${entry.name}`);
}

program
  .command("verify")
  .description(
    "Round-trip a directory through a tool pair and report loss the conversion did not account for",
  )
  .argument("[dir]", "Directory to verify", ".")
  .requiredOption("--from <tool>", `Source harness (${converterNames})`)
  .requiredOption("--to <tool>", `Target harness (${converterNames})`)
  .option("--json", "Emit the drift report as JSON on stdout")
  .action((dir: string, opts: { from: string; to: string; json?: boolean }) => {
    const fromConverter = requireConverter(opts.from, "source");
    const toConverter = requireConverter(opts.to, "target");
    if (opts.from === opts.to) {
      console.error("Source and target must be different.");
      process.exit(1);
    }
    if (!fromConverter.detect(dir)) {
      console.error(`No ${opts.from} configuration found in ${dir}`);
      process.exit(1);
    }

    const out = opts.json ? console.error : console.log;
    const source = fromConverter.import(dir);

    // Never derived from `dir`. A verification command that wrote into the directory it was asked
    // to inspect would be the worst defect this tool could have.
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "harnessport-verify-"));
    const result = toConverter.export(scratch, source, {});
    const loss = roundTripLoss(source, toConverter.import(scratch), result.items);

    if (opts.json) {
      console.log(JSON.stringify({ from: opts.from, to: opts.to, ...loss }, null, 2));
    }

    out(`Verified ${opts.from} -> ${opts.to} via ${scratch}`);
    out(
      `\n${loss.accounted.length} accounted for, ${loss.unaccounted.length} unaccounted for`,
    );
    renderLoss(out, "ACCOUNTED FOR (reported by the conversion)", loss.accounted);
    renderLoss(out, "UNACCOUNTED FOR (lost while reported as exact)", loss.unaccounted);

    if (loss.unaccounted.length > 0) {
      console.error(
        `\n${loss.unaccounted.length} item(s) did not survive and were not reported. This is a defect in the conversion, not in your config.`,
      );
      process.exit(2);
    }
    out("\nEvery loss was accounted for.");
  });

program
  .command("check")
  .description(
    "Report where the harness configs in one directory disagree. Read-only; intended for CI",
  )
  .argument("[dir]", "Directory to check", ".")
  .option("--json", "Emit the divergence report as JSON on stdout")
  .action((dir: string, opts: { json?: boolean }) => {
    const out = opts.json ? console.error : console.log;
    const detected: Array<{ harness: string; config: HarnessConfig }> = [];
    for (const [name, converter] of Object.entries(converters)) {
      if (converter.detect(dir)) {
        detected.push({ harness: name, config: converter.import(dir) });
      }
    }

    if (detected.length === 0) {
      console.error(`No harness configuration detected in ${dir}`);
      process.exit(1);
    }

    const names = detected.map((d) => d.harness);
    if (opts.json) {
      console.log(
        JSON.stringify(
          {
            detected: names,
            divergences: detected.length < 2 ? [] : divergences(detected),
          },
          null,
          2,
        ),
      );
    }

    if (detected.length < 2) {
      out(
        `Only one harness found (${names[0]}); nothing to compare against.`,
      );
      return;
    }

    const found = divergences(detected);
    out(`Detected: ${names.join(", ")}`);
    if (found.length === 0) {
      out("\nThe detected harnesses agree.");
      return;
    }

    out(`\n${found.length} divergence(s)`);
    for (const d of found) {
      out(`  ${d.kind} ${d.name}`);
      out(`    present in ${d.presentIn}, absent from ${d.absentFrom}`);
    }
    console.error(
      `\n${found.length} divergence(s). Run "harnessport convert" to bring one into line with another.`,
    );
    process.exit(2);
  });

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
    console.log(renderCliMatrix());
  });

program.parse();

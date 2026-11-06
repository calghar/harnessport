import type { Formatter, FidelityItem, HarnessConfig } from "../schema.js";

export const FORMAT_RUNNER_MARKER = "harnessport-format.mjs";
export const SHELL_SYNTAX = /["'|&;$<>`]/;

export const shellSyntaxIn = (fmt: Formatter): string | undefined =>
  SHELL_SYNTAX.exec(`${fmt.glob} ${fmt.command}`)?.[0];

export const writableFormatters = (config: HarnessConfig): Formatter[] =>
  config.formatters.filter((f) => shellSyntaxIn(f) === undefined);

/** Glob and command of a runner command line, or undefined when it is not a runner command. */
export function parseRunnerCommand(command: string): Formatter | undefined {
  const runner = new RegExp(`${FORMAT_RUNNER_MARKER}"?\\s+"([^"]*)"\\s+(.*)$`).exec(command);
  return runner ? { glob: runner[1], command: runner[2].trim() } : undefined;
}

/** The runner carries the glob as an argument, so a formatter is exact unless it needs a shell. */
export function formatterItem(fmt: Formatter): FidelityItem {
  const char = shellSyntaxIn(fmt);
  if (char === undefined) {
    return { phase: "export", kind: "formatter", name: fmt.glob, status: "exact" };
  }
  return {
    phase: "export",
    kind: "formatter",
    name: fmt.glob,
    status: "dropped",
    reason: `the formatter runner spawns without a shell, so the \`${char}\` character cannot be passed; this formatter was not written`,
  };
}

// Reads the edited path from stdin, so the formatter needs no shell and no $FILEPATH quoting.
// `fileField` is the stdin expression holding the path, which differs per harness.
export const formatRunnerSource = (fileField: string): string => [
  'import { spawnSync } from "node:child_process";',
  'import { readFileSync } from "node:fs";',
  'import { basename } from "node:path";',
  "const [glob, ...cmd] = process.argv.slice(2);",
  "const toRegExp = (g) => new RegExp(\"^\" + g.replace(/[.+^$()|[\\]\\\\]/g, \"\\\\$&\")",
  "  .replace(/\\{([^}]*)\\}/g, (_, a) => \"(\" + a.split(\",\").join(\"|\") + \")\")",
  "  .replace(/\\*\\*/g, \"\\0\").replace(/\\*/g, \"[^/]*\").replace(/\\?/g, \"[^/]\").replace(/\\0/g, \".*\") + \"$\");",
  "let file;",
  `try { file = JSON.parse(readFileSync(0, "utf-8")).${fileField}; } catch (e) {}`,
  "if (typeof file !== \"string\" || file === \"\" || cmd.length === 0) process.exit(0);",
  "if (!toRegExp(glob).test(glob.includes(\"/\") ? file : basename(file))) process.exit(0);",
  "const r = spawnSync(cmd[0], [...cmd.slice(1), file], { stdio: \"inherit\" });",
  "process.exit(r.status ?? 1);",
  "",
].join("\n");

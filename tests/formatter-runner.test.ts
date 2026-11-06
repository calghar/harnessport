import { describe, it, expect } from "vitest";
import { formatRunnerSource } from "../src/converters/formatter-runner.js";

// The runner source as it was before the move into formatter-runner.ts.
const CLAUDE_RUNNER_BEFORE = [
  'import { spawnSync } from "node:child_process";',
  'import { readFileSync } from "node:fs";',
  'import { basename } from "node:path";',
  "const [glob, ...cmd] = process.argv.slice(2);",
  "const toRegExp = (g) => new RegExp(\"^\" + g.replace(/[.+^$()|[\\]\\\\]/g, \"\\\\$&\")",
  "  .replace(/\\{([^}]*)\\}/g, (_, a) => \"(\" + a.split(\",\").join(\"|\") + \")\")",
  "  .replace(/\\*\\*/g, \"\\0\").replace(/\\*/g, \"[^/]*\").replace(/\\?/g, \"[^/]\").replace(/\\0/g, \".*\") + \"$\");",
  "let file;",
  "try { file = JSON.parse(readFileSync(0, \"utf-8\")).tool_input?.file_path; } catch (e) {}",
  "if (typeof file !== \"string\" || file === \"\" || cmd.length === 0) process.exit(0);",
  "if (!toRegExp(glob).test(glob.includes(\"/\") ? file : basename(file))) process.exit(0);",
  "const r = spawnSync(cmd[0], [...cmd.slice(1), file], { stdio: \"inherit\" });",
  "process.exit(r.status ?? 1);",
  "",
].join("\n");

describe("formatRunnerSource", () => {
  it("reproduces the Claude runner byte for byte", () => {
    expect(formatRunnerSource("tool_input?.file_path")).toBe(CLAUDE_RUNNER_BEFORE);
  });

  it("reads the Cursor payload from the top-level file_path", () => {
    expect(formatRunnerSource("file_path")).toContain(".parse(readFileSync(0, \"utf-8\")).file_path;");
  });
});

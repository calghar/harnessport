import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as fs from "node:fs";
import * as os from "node:os";
import { spawnSync } from "node:child_process";
import { claudeConverter } from "../src/converters/claude.js";
import { opencodeConverter } from "../src/converters/opencode.js";
import { cursorConverter } from "../src/converters/cursor.js";
import { copilotConverter } from "../src/converters/copilot.js";
import { codexConverter } from "../src/converters/codex.js";
import type { Converter } from "../src/converters/types.js";
import type { HarnessConfig, PermissionEntry } from "../src/schema.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Mirrors features/permission-fidelity.feature and features/conversion-reporting.feature,
// The .feature files are the spec of record; these are their executable form, because this
// repo's gate is vitest rather than cucumber-js.

const FIXTURES = path.resolve(HERE, "fixtures");
const SAMPLE = path.join(FIXTURES, "sample-project");
const _OPENCODE_DENY = path.join(FIXTURES, "opencode-deny");
const _CLAUDE_DENY = path.join(FIXTURES, "claude-deny");

const TARGETS: Record<string, Converter> = {
  claude: claudeConverter,
  opencode: opencodeConverter,
  cursor: cursorConverter,
  copilot: copilotConverter,
  codex: codexConverter,
};

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "harnessport-"));
}

/** Export to a real directory and read every emitted file back. */
function exportToDisk(converter: Converter, config: HarnessConfig) {
  const dir = tmpDir();
  const result = converter.export(dir, config, {});
  const contents = result.filesWritten.map((f) =>
    fs.existsSync(f) ? fs.readFileSync(f, "utf-8") : "",
  );
  return { dir, result, contents, joined: contents.join("\n") };
}

function permission(
  tool: string,
  pattern: string,
  action: "allow" | "ask" | "deny",
): PermissionEntry {
  return { tool, pattern, action } as PermissionEntry;
}

function configWith(permissions: PermissionEntry[]): HarnessConfig {
  return {
    rules: [{ content: "# Rules\n\nBe careful.", source: "CLAUDE.md" }],
    agents: [],
    skills: [],
    commands: [],
    mcpServers: [],
    permissions,
    hooks: [],
    formatters: [],
    items: [],
  } as unknown as HarnessConfig;
}

// ---------------------------------------------------------------------------
// Feature: permission-fidelity
// ---------------------------------------------------------------------------

describe("Requirement: A deny is never emitted as allow", () => {
  it("maps each action to its Claude key and refuses a deny a target cannot represent", () => {
    for (const action of ["allow", "ask", "deny"] as const) {
      const { dir } = exportToDisk(claudeConverter, configWith([permission("Bash", "ls *", action)]));
      const settings = JSON.parse(fs.readFileSync(path.join(dir, ".claude", "settings.local.json"), "utf-8"));
      expect(settings.permissions[action]).toContain("Bash(ls *)");
    }
    const expected = { claude: "exact", opencode: "exact", cursor: "exact", copilot: "blocked", codex: "blocked" };
    for (const [target, status] of Object.entries(expected)) {
      const { result, joined } = exportToDisk(TARGETS[target], configWith([permission("Bash", "rm -rf *", "deny")]));
      const permItems = result.items.filter((i) => i.kind === "permission");
      expect(permItems.length, target).toBeGreaterThan(0);
      expect(permItems.every((i) => i.status === status), target).toBe(true);
      if (status === "blocked") expect(joined, target).not.toContain("rm -rf *");
    }
  });
});

// ---------------------------------------------------------------------------
// Feature: conversion-reporting
// ---------------------------------------------------------------------------

describe("Requirement: The supported targets are five harnesses", () => {
  const CLI = path.resolve(HERE, "..", "dist", "index.js");
  const hasBuild = fs.existsSync(CLI);
  const FIVE = ["claude", "opencode", "cursor", "copilot", "codex"];

  function run(args: string[]) {
    const r = spawnSync("node", [CLI, ...args], { encoding: "utf-8" });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  }

  it.runIf(hasBuild)("Windsurf is not a target", () => {
    const out = path.join(tmpDir(), "out");
    const r = run(["convert", "--from", "claude", "--to", "windsurf", "--source", SAMPLE, "--target", out]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("windsurf");
    expect(r.stderr).toContain(FIVE.join(", "));
    expect(fs.existsSync(out)).toBe(false);
  });

});

describe("Requirement: A guardrail a target cannot write or enforce is blocked", () => {
  const CLI = path.resolve(HERE, "..", "dist", "index.js");
  const hasBuild = fs.existsSync(CLI);

  function convertHooks(to: string, hooks: Record<string, unknown[]>) {
    const src = tmpDir();
    fs.mkdirSync(path.join(src, ".claude"));
    fs.writeFileSync(path.join(src, ".claude", "settings.json"), JSON.stringify({ hooks }));
    const out = path.join(tmpDir(), "out");
    const r = spawnSync(
      "node",
      [CLI, "convert", "--from", "claude", "--to", to, "--source", src, "--target", out],
      { encoding: "utf-8" },
    );
    return { status: r.status, out };
  }

  const handler = (event: string, extra: object = {}) => ({
    [event]: [{ matcher: "Bash", hooks: [{ type: "command", command: "./guard.sh", ...extra }] }],
  });

  it.runIf(hasBuild)("OpenCode PreToolUse guardrail exits 2", () => {
    expect(convertHooks("opencode", handler("PreToolUse")).status).toBe(2);
  });

  it.runIf(hasBuild)("Copilot failClosed guardrail exits 2", () => {
    expect(convertHooks("copilot", handler("PreToolUse", { onFailure: "block" })).status).toBe(2);
  });

  it.runIf(hasBuild)("Cursor guardrail exits 0 and writes hooks.json", () => {
    const r = convertHooks("cursor", handler("PreToolUse"));
    expect(r.status).toBe(0);
    expect(fs.existsSync(path.join(r.out, ".cursor", "hooks.json"))).toBe(true);
  });

});

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { roundTripLoss } from "../src/compare.js";
import { cursorConverter } from "../src/converters/cursor.js";
import type { HarnessConfig } from "../src/schema.js";

const emptyConfig = (): HarnessConfig => ({
  rules: [],
  agents: [],
  skills: [],
  commands: [],
  mcpServers: [],
  permissions: [],
  hooks: [],
  formatters: [],
  items: [],
});

const tmpDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "harnessport-cursor-repair-"));

describe("Cursor permission conversion", () => {
  it("replaces home permission arrays and preserves unrelated configuration", () => {
    const home = tmpDir();
    const file = path.join(home, ".cursor", "cli-config.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({
      version: 1,
      model: { name: "custom" },
      permissions: { allow: ["Shell(cursor-only)"], deny: [] },
    }));

    const config = {
      ...emptyConfig(),
      permissions: [
        { tool: "Read", pattern: "./.env", action: "deny" as const },
        { tool: "Bash", pattern: "claude *", action: "allow" as const },
      ],
    };
    const result = cursorConverter.export(home, config, {
      force: true,
      homeDir: home,
    } as Parameters<typeof cursorConverter.export>[2]);
    const json = JSON.parse(fs.readFileSync(file, "utf-8"));

    expect(result.items.filter((item) => item.kind === "permission").map((item) => item.status))
      .toEqual(["exact", "exact"]);
    expect(json.model).toEqual({ name: "custom" });
    expect(json.permissions).toEqual({
      allow: ["Shell(claude:*)"],
      deny: ["Read(./.env)"],
    });
  });

  it("imports documented project permission tokens", () => {
    const root = tmpDir();
    fs.mkdirSync(path.join(root, ".cursor"), { recursive: true });
    fs.writeFileSync(path.join(root, ".cursor", "cli.json"), JSON.stringify({
      permissions: {
        allow: ["Shell(claude:*)", "Mcp(jira:get)"],
        deny: ["Read(.env*)", "Write(**/*.key)", "WebFetch(evil.test)"],
      },
    }));

    expect(cursorConverter.import(root).permissions).toEqual([
      { tool: "Bash", pattern: "claude *", action: "allow" },
      { tool: "mcp__jira__get", pattern: "*", action: "allow" },
      { tool: "Read", pattern: ".env*", action: "deny" },
      { tool: "Write", pattern: "**/*.key", action: "deny" },
      { tool: "WebFetch", pattern: "evil.test", action: "deny" },
    ]);
  });

  it("asks only for the matching MCP call", () => {
    const root = tmpDir();
    const config = {
      ...emptyConfig(),
      permissions: [{ tool: "mcp__jira__jira_post", pattern: "*", action: "ask" as const }],
    };
    cursorConverter.export(root, config);
    const hooks = JSON.parse(fs.readFileSync(path.join(root, ".cursor", "hooks.json"), "utf-8"));
    const command = hooks.hooks.beforeMCPExecution[0].command as string;
    const wrapper = command.replace(/^node\s+"?/, "").replace(/"$/, "");

    const run = (tool: string) => spawnSync("node", [path.join(root, wrapper)], {
      input: JSON.stringify({ mcp_server_name: "jira", tool_name: tool, tool_input: "{}" }),
      encoding: "utf-8",
    });
    expect(JSON.parse(run("jira_post").stdout)).toMatchObject({ permission: "ask" });
    expect(JSON.parse(run("jira_get").stdout)).toEqual({ permission: "allow" });
  });
});

describe("Cursor hook round-trip and cleanup", () => {
  it("imports one Claude Read guard and skips its recorder", () => {
    const root = tmpDir();
    cursorConverter.export(root, {
      ...emptyConfig(),
      hooks: [{ event: "PreToolUse", matcher: "Read", command: "./guard.sh" }],
    });

    expect(cursorConverter.import(root).hooks).toEqual([
      {
        event: "PreToolUse",
        matcher: "Read",
        command: "./guard.sh",
        args: [],
        timeout: undefined,
        failClosed: undefined,
      },
    ]);
  });

  it("detects hook-only and permission-only Cursor directories", () => {
    for (const relative of [".cursor/hooks.json", ".cursor/cli.json"]) {
      const root = tmpDir();
      fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
      fs.writeFileSync(path.join(root, relative), "{}");
      expect(cursorConverter.detect(root)).toBe(true);
    }
  });

  it("removes only stale generated wrappers when forced", () => {
    const root = tmpDir();
    const hooksDir = path.join(root, ".cursor", "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, "harnessport-guard-2.mjs"), "stale");
    fs.writeFileSync(path.join(hooksDir, "foreign.mjs"), "foreign");

    cursorConverter.export(root, {
      ...emptyConfig(),
      hooks: [{ event: "PreToolUse", matcher: "Bash", command: "./guard.sh" }],
    }, { force: true });

    expect(fs.existsSync(path.join(hooksDir, "harnessport-guard-2.mjs"))).toBe(false);
    expect(fs.existsSync(path.join(hooksDir, "foreign.mjs"))).toBe(true);
  });
});

describe("Cursor fidelity", () => {
  it("reports fields Cursor files cannot hold", () => {
    const result = cursorConverter.export(tmpDir(), {
      ...emptyConfig(),
      agents: [{ name: "a", body: "body", skills: ["s"], tools: ["Read"] }],
      commands: [{ name: "c", body: "body", description: "d", allowedTools: ["Read"] }],
      mcpServers: [{ name: "m", type: "stdio", command: "m", enabled: false }],
    });

    expect(result.items.find((item) => item.kind === "agent")).toMatchObject({
      status: "lossy",
      reason: expect.stringMatching(/skills.*tools/),
    });
    expect(result.items.find((item) => item.kind === "command")).toMatchObject({
      status: "lossy",
      reason: expect.stringMatching(/description.*allowedTools/),
    });
    expect(result.items.find((item) => item.kind === "mcp")).toMatchObject({
      status: "lossy",
      reason: expect.stringContaining("enabled"),
    });
  });

  it("detects changed fields and permission actions", () => {
    const source = {
      ...emptyConfig(),
      agents: [{ name: "a", body: "body", tools: ["Read"] }],
      permissions: [{ tool: "Read", pattern: ".env", action: "deny" as const }],
    };
    const target = {
      ...emptyConfig(),
      agents: [{ name: "a", body: "body" }],
      permissions: [{ tool: "Read", pattern: ".env", action: "allow" as const }],
    };

    expect(roundTripLoss(source, target, []).unaccounted).toEqual([
      { kind: "agent", name: "a" },
      { kind: "permission", name: "Read(.env)" },
    ]);
  });

  it("does not report backup creation as conversion loss", () => {
    const root = tmpDir();
    fs.mkdirSync(path.join(root, ".cursor"), { recursive: true });
    fs.writeFileSync(path.join(root, ".cursor", "cli.json"), "{}");
    const result = cursorConverter.export(root, {
      ...emptyConfig(),
      permissions: [{ tool: "Read", pattern: ".env", action: "deny" }],
    }, { force: true, dryRun: true });

    expect(result.items.some((item) => item.name.endsWith(".bak"))).toBe(false);
  });
});

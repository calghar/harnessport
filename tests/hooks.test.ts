import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { claudeConverter } from "../src/converters/claude.js";
import { cursorConverter } from "../src/converters/cursor.js";
import { copilotConverter } from "../src/converters/copilot.js";
import { codexConverter } from "../src/converters/codex.js";
import type { HarnessConfig } from "../src/schema.js";

const tmpDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "harnessport-hooks-"));
const SETTINGS = ".claude/settings.json";

function write(root: string, rel: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content);
}

const readSettings = (root: string) => JSON.parse(fs.readFileSync(path.join(root, SETTINGS), "utf-8"));

const withHooks = (hooks: HarnessConfig["hooks"]): HarnessConfig => ({
  rules: [], agents: [], skills: [], commands: [],
  mcpServers: [], permissions: [], hooks, formatters: [], items: [],
});

describe("Claude hook fields are carried or reported on import", () => {
  it("round-trips onFailure, timeout and args", () => {
    const src = tmpDir();
    const handler = { type: "command", command: "guard", args: ["--strict"], timeout: 10, onFailure: "block" };
    write(src, SETTINGS, JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [handler] }] } }));
    const config = claudeConverter.import(src);
    expect(config.hooks[0]).toMatchObject({ failClosed: true, timeout: 10, args: ["--strict"] });

    const out = tmpDir();
    const { items } = claudeConverter.export(out, config);
    expect(readSettings(out).hooks.PreToolUse[0]).toEqual({ hooks: [handler], matcher: "Bash" });
    expect(items.find((i) => i.kind === "hook")?.status).toBe("exact");
  });

  it("blocks a non-command guardrail and drops another event, importing neither", () => {
    const src = tmpDir();
    write(src, SETTINGS, JSON.stringify({ hooks: {
      PreToolUse: [{ hooks: [{ type: "http", url: "https://example.test/hook" }] }],
      Stop: [{ hooks: [{ type: "prompt", prompt: "check" }] }],
    } }));
    const { hooks, items } = claudeConverter.import(src);
    expect(hooks).toEqual([]);
    expect(items.find((i) => i.name === "PreToolUse")).toMatchObject({ status: "blocked" });
    expect(items.find((i) => i.name === "PreToolUse")?.reason).toMatch(/http/);
    expect(items.find((i) => i.name === "Stop")?.status).toBe("dropped");
  });
});

describe("Existing Claude settings are not removed or rewritten", () => {
  it("leaves both Claude files unchanged when exporting to cursor in place", () => {
    const dir = tmpDir();
    const files = {
      [SETTINGS]: JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "./g.sh" }] }] } }, null, 4),
      ".claude/settings.local.json": '{"permissions":{"deny":["Bash(rm *)"]}}',
    };
    for (const [rel, content] of Object.entries(files)) write(dir, rel, content);
    cursorConverter.export(dir, claudeConverter.import(dir));
    for (const [rel, content] of Object.entries(files)) {
      expect(fs.readFileSync(path.join(dir, rel), "utf-8")).toBe(content);
    }
  });
});

describe("Copilot and Codex hook export", () => {
  it("writes a Copilot hooks file at version 1 and reports a claude PreToolUse as lossy", () => {
    const out = tmpDir();
    const { items } = copilotConverter.export(out, withHooks([{ event: "PreToolUse", matcher: "Bash", command: "./g.sh" }]), {});
    const file = JSON.parse(fs.readFileSync(path.join(out, ".github/hooks/hooks.json"), "utf-8"));
    expect(file.version).toBe(1);
    expect(file.hooks).toBeTypeOf("object");
    expect(items.find((i) => i.kind === "hook")?.status).toBe("lossy");
  });

  it("preserves Copilot source filenames, grouping, and bare files", () => {
    const src = tmpDir();
    write(src, ".github/hooks/policy.json", JSON.stringify({ version: 1, hooks: {
      preToolUse: [{ type: "command", bash: "./policy.sh" }],
    } }));
    write(src, ".github/hooks/audit.json", JSON.stringify({ version: 1, hooks: {
      postToolUse: [{ type: "command", bash: "./audit.sh" }],
    } }));
    write(src, ".github/hooks/lifecycle.json", JSON.stringify({ version: 1, hooks: {
      sessionStart: [{ type: "command", bash: "./start.sh" }],
      sessionEnd: [{ type: "command", bash: "./end.sh" }],
    } }));
    write(src, ".github/hooks/guard.json", JSON.stringify({
      PreToolUse: [{ type: "command", bash: "./guard.sh" }],
    }));

    const config = copilotConverter.import(src);
    expect(config.hooks.map((hook) => hook.sourceFile).sort()).toEqual([
      "audit.json", "guard.json", "lifecycle.json", "lifecycle.json", "policy.json",
    ]);

    const out = tmpDir();
    copilotConverter.export(out, config);
    expect(JSON.parse(fs.readFileSync(path.join(out, ".github/hooks/lifecycle.json"), "utf-8")).hooks)
      .toMatchObject({ sessionStart: expect.any(Array), sessionEnd: expect.any(Array) });
    expect(JSON.parse(fs.readFileSync(path.join(out, ".github/hooks/guard.json"), "utf-8")).version).toBe(1);
    expect(fs.existsSync(path.join(out, ".github/hooks/hooks.json"))).toBe(false);
  });

  it("keeps named and unnamed Copilot hooks in separate files", () => {
    const out = tmpDir();
    copilotConverter.export(out, withHooks([
      { event: "postToolUse", command: "./policy.sh", dialect: "copilot", sourceFile: "policy.json" },
      { event: "PostToolUse", command: "./default.sh" },
      { event: "Stop", command: "./invalid.sh", sourceFile: "../escape.json" },
    ]));
    expect(fs.readFileSync(path.join(out, ".github/hooks/policy.json"), "utf-8")).toContain("./policy.sh");
    const fallback = fs.readFileSync(path.join(out, ".github/hooks/hooks.json"), "utf-8");
    expect(fallback).toContain("./default.sh");
    expect(fallback).toContain("./invalid.sh");
    expect(fs.existsSync(path.join(out, ".github/escape.json"))).toBe(false);
  });

  it("does not overwrite a conflicting retained Copilot hook file", () => {
    const out = tmpDir();
    const file = ".github/hooks/guard.json";
    write(out, file, '{"foreign":true}\n');
    const result = copilotConverter.export(out, withHooks([
      { event: "PreToolUse", command: "./guard.sh", sourceFile: "guard.json" },
    ]));
    expect(fs.readFileSync(path.join(out, file), "utf-8")).toBe('{"foreign":true}\n');
    expect(result.items).toContainEqual(expect.objectContaining({
      name: path.join(out, file),
      status: "blocked",
    }));
  });

  it("writes only Bash-matcher Codex hooks and blocks an Edit|Write guardrail", () => {
    const out = tmpDir();
    const { items } = codexConverter.export(out, withHooks([
      { event: "PreToolUse", matcher: "Bash", command: "./bash.sh" },
      { event: "PreToolUse", matcher: "Edit|Write", command: "./edit.sh" },
    ]), {});
    const written = fs.readFileSync(path.join(out, ".codex/hooks.json"), "utf-8");
    expect(written).toContain("./bash.sh");
    expect(written).not.toContain("./edit.sh");
    expect(items.filter((i) => i.kind === "hook").map((i) => i.status)).toEqual(["exact", "blocked"]);
  });
});

describe("Plain Claude hooks and generateDropItems callers", () => {
  const rich: HarnessConfig = {
    ...withHooks([{ event: "PostToolUse", matcher: "Bash", command: "./log.sh" }]),
    rules: [{ content: "Be careful.", source: "rules.md" }],
    agents: [{ name: "reviewer", body: "AGENT-BODY-MARKER", description: "Reviews" }],
    skills: [{ name: "testing", body: "Test it." }],
    commands: [{ name: "ship", body: "Ship it." }],
    mcpServers: [{ name: "fs", type: "stdio", command: "npx", args: ["mcp-fs"] }],
  };

  it("emits a plain command hook as {type, command} only", () => {
    const out = tmpDir();
    claudeConverter.export(out, withHooks([{ event: "PreToolUse", matcher: "Bash", command: "./g.sh" }]));
    expect(readSettings(out).hooks.PreToolUse).toEqual([
      { matcher: "Bash", hooks: [{ type: "command", command: "./g.sh" }] },
    ]);
  });

  it("cursor reports no agent, skill, command or mcp item as dropped", () => {
    const out = tmpDir();
    const { items } = cursorConverter.export(out, rich, {});
    expect(items.filter((i) => ["agent", "skill", "command", "mcp"].includes(i.kind)).map((i) => i.status))
      .toEqual(["exact", "exact", "exact", "exact"]);
    expect(fs.existsSync(path.join(out, ".cursor/mcp.json"))).toBe(true);
  });

  it("codex drops agents, commands and mcp servers, and writes no agent body", () => {
    const out = tmpDir();
    const { items } = codexConverter.export(out, rich, {});
    for (const kind of ["agent", "command", "mcp"] as const) {
      expect(items.find((i) => i.kind === kind)?.status, kind).toBe("dropped");
    }
    expect(items.find((i) => i.kind === "hook")?.status).toBe("exact");
    expect(fs.readFileSync(path.join(out, "AGENTS.md"), "utf-8")).not.toContain("AGENT-BODY-MARKER");
  });
});

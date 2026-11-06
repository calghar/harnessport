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

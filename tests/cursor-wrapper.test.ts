import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { claudeConverter } from "../src/converters/claude.js";
import { cursorConverter } from "../src/converters/cursor.js";
import type { ExportOptions } from "../src/converters/types.js";
import type { Hook, HarnessConfig } from "../src/schema.js";

const WRAPPER = ".cursor/hooks/harnessport-guard-1.mjs";
const SHELL = JSON.stringify({ tool_name: "Shell", tool_input: { command: "ls" } });

const tmpDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "harnessport-cursor-"));
const configWith = (...hooks: Hook[]): HarnessConfig => ({
  rules: [], agents: [], skills: [], commands: [], mcpServers: [], permissions: [], hooks,
  formatters: [], items: [],
});
const guard = (extra: Partial<Hook> = {}): Hook => ({
  event: "PreToolUse", matcher: "Bash", command: "node stub.mjs", ...extra,
});

/** Exports a wrapper around `stub` (a node script) and runs it with `stdin`. */
function runWith(stub: string | undefined, stdin = SHELL, hook: Partial<Hook> = {}) {
  const dir = tmpDir();
  if (stub !== undefined) fs.writeFileSync(path.join(dir, "stub.mjs"), stub);
  cursorConverter.export(dir, configWith(guard(hook)), {});
  const r = spawnSync("node", [WRAPPER], { cwd: dir, input: stdin, encoding: "utf-8" });
  return { dir, status: r.status, stdout: r.stdout, stderr: r.stderr };
}
const printing = (stdout: string, stderr = "", code = 0): string =>
  `process.stdout.write(${JSON.stringify(stdout)});process.stderr.write(${JSON.stringify(stderr)});process.exit(${code});`;
describe("Cursor wrapper", () => {
  it("maps the command's exit code and stdout per the spec table", () => {
    const deny: Array<[string, string, number, string]> = [
      ["exit 2 denies and forwards stderr", printing("", "no rm", 2), 2, "no rm"],
      ["a JSON deny exits 2 with the reason", printing(JSON.stringify({ hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason: "blocked by policy" } })), 2, "blocked by policy"],
      ["a legacy block exits 2", printing(JSON.stringify({ decision: "block", reason: "legacy" })), 2, "legacy"],
      ["ask is treated as deny", printing(JSON.stringify({ hookSpecificOutput: { permissionDecision: "ask" } })), 2, ""],
      ["JSON that is not an object exits 2", printing("[1]"), 2, ""],
      ["a crash exits 1", printing("", "", 1), 1, ""],
      ["an odd exit code exits 1", printing("", "", 7), 1, ""],
    ];
    for (const [name, stub, code, stderr] of deny) {
      const r = runWith(stub);
      expect(r.status, name).toBe(code);
      expect(r.stdout, name).toBe("");
      expect(r.stderr, name).toContain(stderr);
    }
    for (const out of ["", "{}", JSON.stringify({ decision: "approve" }), JSON.stringify({ hookSpecificOutput: { permissionDecision: "allow" } })]) {
      const r = runWith(printing(out));
      expect(r.status).toBe(0);
      expect(JSON.parse(r.stdout)).toEqual({ permission: "allow" });
    }
    const updated = { hookSpecificOutput: { permissionDecision: "allow", updatedInput: { command: "ls -la" } } };
    expect(JSON.parse(runWith(printing(JSON.stringify(updated))).stdout)).toEqual({ permission: "allow", updated_input: { command: "ls -la" } });
    expect(runWith(undefined, SHELL, { command: "./does-not-exist.sh" }).status).toBe(1);
  }, 60_000);

  it("allows non-JSON stdout and forwards it to stderr", () => {
    const r = runWith(printing("Warning: x"));
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ permission: "allow" });
    expect(r.stderr).toContain("Warning: x");
  });

  it("renames Shell to Bash and leaves other tool names unchanged", () => {
    const stdinStub = 'import { readFileSync, writeFileSync } from "node:fs";writeFileSync("seen.json", readFileSync(0, "utf-8"));';
    const seen = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, "seen.json"), "utf-8"));
    expect(seen(runWith(stdinStub).dir)).toEqual({ tool_name: "Bash", tool_input: { command: "ls" } });
    const payload = { tool_name: "Write", tool_input: { file_path: "/x" } };
    expect(seen(runWith(stdinStub, JSON.stringify(payload)).dir)).toEqual(payload);
  });
});

const read = (dir: string, rel: string) => fs.readFileSync(path.join(dir, rel), "utf-8");

describe("Cursor hook export honesty", () => {
  const TSX = path.resolve("node_modules/.bin/tsx");
  const CLI = path.resolve("src/index.ts");
  const handler = { type: "command", command: "./guard.sh" };
  const convert = (src: string, target: string) =>
    spawnSync(TSX, [CLI, "convert", "--from", "claude", "--to", "cursor", "--source", src, "--target", target, "--json"], { encoding: "utf-8" });
  const claudeProject = (): string => {
    const src = tmpDir();
    fs.mkdirSync(path.join(src, ".claude"));
    fs.writeFileSync(
      path.join(src, ".claude", "settings.json"),
      JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [handler] }] } }),
    );
    return src;
  };
  const hookItem = (stdout: string) =>
    (JSON.parse(stdout).items as Array<{ kind: string; name: string; status: string; reason?: string }>).find(
      (i) => i.kind === "hook" && i.name === "PreToolUse",
    );

  it("reports the guardrail blocked and exits 2 when hooks.json is refused", () => {
    const target = tmpDir();
    const differing = '{"version":1,"hooks":{"afterFileEdit":[{"command":"./audit.sh"}]}}';
    fs.mkdirSync(path.join(target, ".cursor"));
    fs.writeFileSync(path.join(target, ".cursor", "hooks.json"), differing);
    const r = convert(claudeProject(), target);
    expect(r.status).toBe(2);
    const item = hookItem(r.stdout);
    expect(item?.status).toBe("blocked");
    expect(item?.reason).toMatch(/already exists/);
    expect(read(target, ".cursor/hooks.json")).toBe(differing);
  }, 60_000);

  it("keeps the exact status and exit 0 when hooks.json is written", () => {
    const target = tmpDir();
    const r = convert(claudeProject(), target);
    expect(r.status).toBe(0);
    expect(hookItem(r.stdout)?.status).toBe("exact");
    expect(JSON.parse(read(target, ".cursor/hooks.json")).hooks.preToolUse).toHaveLength(1);
  }, 60_000);
});

describe("Cursor hook export", () => {

  it("writes hooks.json and the wrapper, and is idempotent", () => {
    const dir = tmpDir();
    const config = configWith(guard({ command: "./guard.sh", timeout: 10, failClosed: true }));
    const first = cursorConverter.export(dir, config, {});
    expect(JSON.parse(read(dir, ".cursor/hooks.json"))).toEqual({
      version: 1,
      hooks: { preToolUse: [{ command: `node ${WRAPPER}`, matcher: "Shell", timeout: 10, failClosed: true }] },
    });
    expect(read(dir, WRAPPER)).toContain("./guard.sh");
    expect(first.items.find((i) => i.kind === "hook")?.reason).toMatch(/node.*runs twice/);
    expect(fs.existsSync(path.join(dir, ".claude"))).toBe(false);

    const before = [read(dir, ".cursor/hooks.json"), read(dir, WRAPPER)];
    const again = cursorConverter.export(dir, config, {});
    expect([read(dir, ".cursor/hooks.json"), read(dir, WRAPPER)]).toEqual(before);
    expect(again.items.some((i) => i.status === "blocked")).toBe(false);
  });

  it("converts a claude export into hooks.json and the wrapper, byte-identical on re-run", () => {
    const src = tmpDir();
    fs.mkdirSync(path.join(src, ".claude"));
    fs.writeFileSync(path.join(src, ".claude/settings.json"), JSON.stringify({
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "./guard.sh", timeout: 10, onFailure: "block" }] }] },
    }));
    const config = claudeConverter.import(src);
    const out = tmpDir();
    cursorConverter.export(out, config, {});
    expect(JSON.parse(read(out, ".cursor/hooks.json")).hooks.preToolUse[0])
      .toEqual({ command: `node ${WRAPPER}`, matcher: "Shell", timeout: 10, failClosed: true });
    expect(read(out, WRAPPER)).toContain("./guard.sh");
    const before = [read(out, ".cursor/hooks.json"), read(out, WRAPPER)];
    cursorConverter.export(out, config, {});
    expect([read(out, ".cursor/hooks.json"), read(out, WRAPPER)]).toEqual(before);
  });

  it("maps supported matchers and blocks unsupported ones without writing", () => {
    const mapped: Array<[string | undefined, string, string]> = [
      ["Bash|Edit", "Shell|Write", "lossy"],
      ["Bash|Read", "Shell|Read", "lossy"],
      ["*", "*", "lossy"],
    ];
    for (const [matcher, expected, status] of mapped) {
      const dir = tmpDir();
      const { items } = cursorConverter.export(dir, configWith(guard({ matcher })), {});
      expect(JSON.parse(read(dir, ".cursor/hooks.json")).hooks.preToolUse[0].matcher).toBe(expected);
      expect(items.find((i) => i.kind === "hook")?.status).toBe(status);
    }
    for (const [matcher, token] of [["Bash.*", "Bash.*"], ["Bash|Task", "Task"]]) {
      const dir = tmpDir();
      const item = cursorConverter.export(dir, configWith(guard({ matcher })), {}).items.find((i) => i.kind === "hook");
      expect(item?.status).toBe("blocked");
      expect(item?.reason).toContain(token);
      expect(fs.existsSync(path.join(dir, ".cursor"))).toBe(false);
    }
  });

  it("writes nothing for a Read or Write guardrail that Cursor runs natively", () => {
    const dir = tmpDir();
    const { items } = cursorConverter.export(dir, configWith(guard({ matcher: "Read|Write" })), {});
    expect(fs.existsSync(path.join(dir, ".cursor"))).toBe(false);
    const item = items.find((i) => i.kind === "hook");
    expect(item?.status).toBe("lossy");
    expect(item?.reason).toContain("Third-Party Imports");
    expect(item?.reason).toContain("does not run");
    expect(item?.reason).toContain("offset or limit");
  });

  it("numbers wrappers over written hooks only", () => {
    const dir = tmpDir();
    cursorConverter.export(dir, configWith(guard({ matcher: "Write" }), guard()), {});
    expect(fs.existsSync(path.join(dir, WRAPPER))).toBe(true);
    expect(JSON.parse(read(dir, ".cursor/hooks.json")).hooks.preToolUse).toHaveLength(1);
  });

  it("keeps Bash and no-matcher output byte-identical to before", () => {
    const sha = (dir: string, rel: string) => createHash("sha256").update(fs.readFileSync(path.join(dir, rel))).digest("hex");
    const dir = tmpDir();
    const { items } = cursorConverter.export(dir, configWith(guard({ command: "./guard.sh" })), {});
    expect(sha(dir, WRAPPER)).toBe("b511e05abf278527511691ca9a582c47ace152a1282b276fae463b996c771241");
    expect(sha(dir, ".cursor/hooks.json")).toBe("954581d9f698edf7ee47bdfad1d167caf3b4df03596a669c1a48a852a73473c0");
    expect(items.find((i) => i.kind === "hook")?.status).toBe("exact");

    const bare = tmpDir();
    const bareItems = cursorConverter.export(bare, configWith(guard({ matcher: undefined, command: "./guard.sh" })), {}).items;
    expect(read(bare, WRAPPER)).toBe(read(dir, WRAPPER));
    expect(JSON.parse(read(bare, ".cursor/hooks.json")).hooks.preToolUse[0].matcher).toBe("*");
    expect(bareItems.find((i) => i.kind === "hook")?.status).toBe("lossy");
  });

  it("keeps the wrapper for Bash|Read and reports the lost offset and limit", () => {
    const dir = tmpDir();
    const { items } = cursorConverter.export(dir, configWith(guard({ matcher: "Bash|Read" })), {});
    expect(fs.existsSync(path.join(dir, WRAPPER))).toBe(true);
    const item = items.find((i) => i.kind === "hook");
    expect(item?.status).toBe("lossy");
    expect(item?.reason).toContain("offset or limit");
  });

  it("quotes the absolute wrapper path when the home directory contains a space", () => {
    const home = path.join(tmpDir(), "my home");
    fs.mkdirSync(home);
    fs.writeFileSync(path.join(home, "stub.mjs"), "");
    cursorConverter.export(home, configWith(guard()), { homeDir: home } as ExportOptions);
    const command: string = JSON.parse(read(home, ".cursor/hooks.json")).hooks.preToolUse[0].command;
    const wrapperPath = path.join(home, WRAPPER);
    expect(command).toBe(`node "${wrapperPath}"`);
    expect(fs.existsSync(wrapperPath)).toBe(true);
    const r = spawnSync(command, { shell: true, cwd: home, input: SHELL, encoding: "utf-8" });
    expect(r.status).toBe(0);
  });
});

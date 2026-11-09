import { describe, it, expect, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { claudeConverter } from "../src/converters/claude.js";
import { cursorConverter } from "../src/converters/cursor.js";
import type { ExportOptions } from "../src/converters/types.js";
import type { Hook, HarnessConfig } from "../src/schema.js";

// Each case spawns Node wrapper processes; 5 s was too tight under load.
vi.setConfig({ testTimeout: 30_000 });

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
function runWith(stub: string | undefined, stdin = SHELL, hook: Partial<Hook> = {}, dir = tmpDir()) {
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
    const brief = { tool_name: "Subagent", tool_input: { prompt: "brief", subagent_type: "generalPurpose" } };
    expect(seen(runWith(stdinStub, JSON.stringify(brief)).dir)).toEqual({
      tool_name: "Agent",
      tool_input: brief.tool_input,
    });
  });
});

const SHELL_EVENT = JSON.stringify({ command: "ls", cwd: "/w", workspace_roots: ["/w"], hook_event_name: "beforeShellExecution" });
const lines = (n: number): string => `${Array.from({ length: n }, (_, i) => `l${i}`).join("\n")}\n`;
const SEEN_STUB = 'import { readFileSync, writeFileSync } from "node:fs";writeFileSync("seen.json", readFileSync(0, "utf-8"));';
const asking = printing(JSON.stringify({ hookSpecificOutput: { permissionDecision: "ask", permissionDecisionReason: "confirm rm" } }));

describe("Cursor beforeShellExecution", () => {
  it("registers a Shell-only hook without a matcher and keeps Shell|Grep on preToolUse", () => {
    const dir = tmpDir();
    cursorConverter.export(dir, configWith(guard({ matcher: "Bash|Grep" }), guard()), {});
    expect(JSON.parse(read(dir, ".cursor/hooks.json"))).toEqual({
      version: 1,
      hooks: {
        preToolUse: [{ command: `node ${WRAPPER}`, matcher: "Shell|Grep" }],
        beforeShellExecution: [{ command: "node .cursor/hooks/harnessport-guard-2.mjs" }],
      },
    });
  });

  it("answers ask with the permission-ask JSON and exit 0", () => {
    const r = runWith(asking, SHELL_EVENT);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ permission: "ask", user_message: "confirm rm", agent_message: "confirm rm" });
  });

  it("still denies ask for a preToolUse payload", () => {
    const r = runWith(asking);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
  });

  it("hands the hook a Bash payload built from the shell event", () => {
    const stub = 'import { readFileSync, writeFileSync } from "node:fs";writeFileSync("seen.json", readFileSync(0, "utf-8"));';
    const r = runWith(stub, SHELL_EVENT);
    expect(JSON.parse(fs.readFileSync(path.join(r.dir, "seen.json"), "utf-8"))).toEqual({
      command: "ls", cwd: "/w", workspace_roots: ["/w"], hook_event_name: "beforeShellExecution",
      tool_name: "Bash", tool_input: { command: "ls", working_directory: "/w" },
    });
  });
});

describe("Cursor beforeReadFile", () => {
  const seenLimit = (fileLines: number | undefined, contentLines: number): number | undefined => {
    const dir = tmpDir();
    const file = path.join(dir, "big.txt");
    if (fileLines !== undefined) fs.writeFileSync(file, lines(fileLines));
    const payload = JSON.stringify({ hook_event_name: "beforeReadFile", file_path: file, content: lines(contentLines) });
    const r = runWith(SEEN_STUB, payload, { matcher: "Read" }, dir);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ permission: "allow" });
    const seen = JSON.parse(fs.readFileSync(path.join(dir, "seen.json"), "utf-8"));
    expect(seen.tool_name).toBe("Read");
    expect(seen.tool_input.file_path).toBe(file);
    return seen.tool_input.limit;
  };

  it("sets limit for a ranged read", () => expect(seenLimit(600, 10)).toBe(10));
  it("sets no limit for a full read", () => expect(seenLimit(600, 600)).toBeUndefined());
  it("sets no limit when the file is unreadable", () => expect(seenLimit(undefined, 10)).toBeUndefined());

  it("exits 2 with the reason when the hook denies", () => {
    const deny = printing(JSON.stringify({ hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason: "too big" } }));
    const r = runWith(deny, JSON.stringify({ hook_event_name: "beforeReadFile", file_path: "/x", content: "a" }), { matcher: "Read" });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("too big");
  });
});

describe("Cursor Read marker pairing", () => {
  const readJson = (file: string, id: unknown, n = 600) =>
    JSON.stringify({ hook_event_name: "beforeReadFile", file_path: file, content: lines(n), tool_use_id: id });
  const setup = (stub: string) => {
    const dir = tmpDir();
    const tmp = tmpDir();
    fs.writeFileSync(path.join(dir, "stub.mjs"), stub);
    fs.writeFileSync(path.join(dir, "big.txt"), lines(600));
    cursorConverter.export(dir, configWith(guard({ matcher: "Read" })), {});
    const run = (n: number, input: string) =>
      spawnSync("node", [`.cursor/hooks/harnessport-guard-${n}.mjs`], { cwd: dir, input, encoding: "utf-8", env: { ...process.env, TMPDIR: tmp } });
    const marker = (id: string) => path.join(tmp, "harnessport-read", id);
    return { dir, run, marker, file: path.join(dir, "big.txt"), ran: () => fs.existsSync(path.join(dir, "seen.json")) };
  };
  const deny = printing("", "too big", 2);

  it("records a marker and does not run the command", () => {
    const t = setup(SEEN_STUB);
    const r = t.run(2, JSON.stringify({ hook_event_name: "preToolUse", tool_name: "Read", tool_use_id: "t1" }));
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ permission: "allow" });
    expect(fs.existsSync(t.marker("t1"))).toBe(true);
    expect(t.ran()).toBe(false);
  });

  it("enforces a full read with a marker and removes the marker", () => {
    const t = setup(deny);
    t.run(2, JSON.stringify({ tool_use_id: "t2" }));
    const r = t.run(1, readJson(t.file, "t2"));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("too big");
    expect(fs.existsSync(t.marker("t2"))).toBe(false);
  });

  it("sets limit for a ranged read with a marker", () => {
    const t = setup(SEEN_STUB);
    t.run(2, JSON.stringify({ tool_use_id: "t3" }));
    const r = t.run(1, readJson(t.file, "t3", 10));
    expect(r.status).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(t.dir, "seen.json"), "utf-8")).tool_input.limit).toBe(10);
  });

  it("allows without running the command when the id has no marker", () => {
    const t = setup(SEEN_STUB);
    const r = t.run(1, readJson(t.file, "nomarker"));
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ permission: "allow" });
    expect(t.ran()).toBe(false);
  });

  it("runs the command when tool_use_id is missing, not a string or unsafe", () => {
    for (const id of [undefined, "", 7, "../x", "a/b", "a\\b"]) {
      const t = setup(deny);
      expect(t.run(1, readJson(t.file, id)).status, String(id)).toBe(2);
    }
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
    expect(JSON.parse(read(target, ".cursor/hooks.json")).hooks.beforeShellExecution).toHaveLength(1);
  }, 60_000);
});

describe("Cursor hook export", () => {

  it("writes hooks.json and the wrapper, and is idempotent", () => {
    const dir = tmpDir();
    const config = configWith(guard({ command: "./guard.sh", timeout: 10, failClosed: true }));
    const first = cursorConverter.export(dir, config, {});
    expect(JSON.parse(read(dir, ".cursor/hooks.json"))).toEqual({
      version: 1,
      hooks: { beforeShellExecution: [{ command: `node ${WRAPPER}`, timeout: 10, failClosed: true }] },
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
    expect(JSON.parse(read(out, ".cursor/hooks.json")).hooks.beforeShellExecution[0])
      .toEqual({ command: `node ${WRAPPER}`, timeout: 10, failClosed: true });
    expect(read(out, WRAPPER)).toContain("./guard.sh");
    const before = [read(out, ".cursor/hooks.json"), read(out, WRAPPER)];
    cursorConverter.export(out, config, {});
    expect([read(out, ".cursor/hooks.json"), read(out, WRAPPER)]).toEqual(before);
  });

  it("maps supported matchers and blocks unsupported ones without writing", () => {
    const mapped: Array<[string | undefined, string, string]> = [
      ["Bash|Edit", "Shell|Write", "lossy"],
      ["Agent", "Subagent", "exact"],
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

  it("wraps a Write guardrail on preToolUse and a Read guardrail on beforeReadFile", () => {
    const dir = tmpDir();
    const { items } = cursorConverter.export(dir, configWith(guard({ matcher: "Write" }), guard({ matcher: "Read" })), {});
    expect(JSON.parse(read(dir, ".cursor/hooks.json")).hooks).toEqual({
      preToolUse: [
        { command: `node ${WRAPPER}`, matcher: "Write" },
        { command: "node .cursor/hooks/harnessport-guard-3.mjs", matcher: "Read" },
      ],
      beforeReadFile: [{ command: "node .cursor/hooks/harnessport-guard-2.mjs" }],
    });
    const hooks = items.filter((i) => i.kind === "hook");
    expect(hooks[0]?.status).toBe("exact");
    expect(hooks[1]?.status).toBe("lossy");
    expect(hooks[1]?.reason).toContain("content line count");
  });

  it("numbers wrappers over written hooks only", () => {
    const dir = tmpDir();
    cursorConverter.export(dir, configWith(guard({ matcher: "Write" }), guard()), {});
    expect(fs.existsSync(path.join(dir, WRAPPER))).toBe(true);
    expect(JSON.parse(read(dir, ".cursor/hooks.json")).hooks.beforeShellExecution).toHaveLength(1);
  });

  it("keeps Bash and no-matcher output byte-identical to before", () => {
    const sha = (dir: string, rel: string) => createHash("sha256").update(fs.readFileSync(path.join(dir, rel))).digest("hex");
    const dir = tmpDir();
    const { items } = cursorConverter.export(dir, configWith(guard({ command: "./guard.sh" })), {});
    expect(sha(dir, WRAPPER)).toBe("98ca6189dd465bb2a13b6b53ce6e955f410815d7b9c5deb47e2de1b4cff2d748");
    expect(sha(dir, ".cursor/hooks.json")).toBe("e7a3f206398f492486d2ea88123a226600aac2fe3ad231c6a3fa23f78219af67");
    expect(items.find((i) => i.kind === "hook")?.status).toBe("exact");

    const bare = tmpDir();
    const bareItems = cursorConverter.export(bare, configWith(guard({ matcher: undefined, command: "./guard.sh" })), {}).items;
    const [bareMetadata, ...bareWrapper] = read(bare, WRAPPER).split("\n");
    const [bashMetadata, ...bashWrapper] = read(dir, WRAPPER).split("\n");
    expect(bareMetadata).toBe('const HOOK = {"command":"./guard.sh","sourceEvent":"PreToolUse"};');
    expect(bashMetadata).toContain('"matcher":"Bash"');
    expect(bareWrapper).toEqual(bashWrapper);
    expect(JSON.parse(read(bare, ".cursor/hooks.json")).hooks.preToolUse[0].matcher).toBe("*");
    expect(bareItems.find((i) => i.kind === "hook")?.status).toBe("lossy");
  });

  it("writes one wrapper per Cursor event for Bash|Read and merges the reasons", () => {
    const dir = tmpDir();
    const { items } = cursorConverter.export(dir, configWith(guard({ matcher: "Bash|Read", timeout: 5, failClosed: true })), {});
    expect(JSON.parse(read(dir, ".cursor/hooks.json")).hooks).toEqual({
      beforeShellExecution: [{ command: `node ${WRAPPER}`, timeout: 5, failClosed: true }],
      beforeReadFile: [{ command: "node .cursor/hooks/harnessport-guard-2.mjs", timeout: 5, failClosed: true }],
      preToolUse: [{ command: "node .cursor/hooks/harnessport-guard-3.mjs", matcher: "Read" }],
    });
    const hooks = items.filter((i) => i.kind === "hook");
    expect(hooks).toHaveLength(1);
    expect(hooks[0]?.status).toBe("lossy");
    expect(hooks[0]?.reason).toContain("content line count");
  });

  it("quotes the absolute wrapper path when the home directory contains a space", () => {
    const home = path.join(tmpDir(), "my home");
    fs.mkdirSync(home);
    fs.writeFileSync(path.join(home, "stub.mjs"), "");
    cursorConverter.export(home, configWith(guard()), { homeDir: home } as ExportOptions);
    const command: string = JSON.parse(read(home, ".cursor/hooks.json")).hooks.beforeShellExecution[0].command;
    const wrapperPath = path.join(home, WRAPPER);
    expect(command).toBe(`node "${wrapperPath}"`);
    expect(fs.existsSync(wrapperPath)).toBe(true);
    const r = spawnSync(command, { shell: true, cwd: home, input: SHELL, encoding: "utf-8" });
    expect(r.status).toBe(0);
  });

  describe("other hook events", () => {
    const EVENTS: Array<[string, string, string?]> = [
      ["SessionStart", "sessionStart"], ["SessionEnd", "sessionEnd"], ["Stop", "stop"],
      ["SubagentStart", "subagentStart"], ["SubagentStop", "subagentStop"], ["PreCompact", "preCompact"],
      ["UserPromptSubmit", "beforeSubmitPrompt"], ["PostToolUse", "postToolUse", "Shell"],
      ["PostToolUseFailure", "postToolUseFailure", "Shell"],
    ];
    const hookFor = (event: string, extra: Partial<Hook> = {}): Hook => ({ event, command: "node stub.mjs", ...extra });
    const wrapperOut = (event: string, stub: string, stdin: Record<string, unknown> = {}) => {
      const dir = tmpDir();
      fs.writeFileSync(path.join(dir, "stub.mjs"), stub);
      cursorConverter.export(dir, configWith(hookFor(event)), {});
      const r = spawnSync("node", [WRAPPER], { cwd: dir, input: JSON.stringify(stdin), encoding: "utf-8" });
      return { status: r.status, stdout: r.stdout, stderr: r.stderr };
    };

    it.each(EVENTS)("%s is written under %s", (event, cursor, matcher) => {
      const dir = tmpDir();
      const { items } = cursorConverter.export(dir, configWith(hookFor(event, matcher ? { matcher: "Bash" } : {})), {});
      const entry = JSON.parse(read(dir, ".cursor/hooks.json")).hooks[cursor];
      expect(entry).toEqual([{ command: "node .cursor/hooks/harnessport-guard-1.mjs", ...(matcher && { matcher }) }]);
      const item = items.find((i) => i.name === event);
      expect(item?.status).toBe(event === "SessionEnd" ? "exact" : "lossy");
      expect(item?.reason).toContain("Third-Party Imports");
    });

    it("keeps the fidelity keywords", () => {
      const reason = (event: string) => cursorConverter.export(tmpDir(), configWith(hookFor(event)), {}).items[0].reason;
      expect(reason("Stop")).toContain("loop_limit");
      expect(reason("SubagentStop")).toContain("loop_limit");
      expect(reason("PreCompact")).toContain("observer");
    });

    it("writes no matcher for sessionStart and passes a subagent type through", () => {
      const dir = tmpDir();
      cursorConverter.export(dir, configWith(hookFor("SessionStart", { matcher: "x" }), hookFor("SubagentStop", { matcher: "explore" })), {});
      const hooks = JSON.parse(read(dir, ".cursor/hooks.json")).hooks;
      expect(hooks.sessionStart[0]).not.toHaveProperty("matcher");
      expect(hooks.subagentStop[0].matcher).toBe("explore");
    });

    it("blocks a PreCompact guardrail, drops Notification and blocks PermissionRequest", () => {
      const dir = tmpDir();
      const { items } = cursorConverter.export(
        dir,
        configWith(hookFor("PreCompact", { failClosed: true }), hookFor("Notification"), hookFor("PermissionRequest")),
        {},
      );
      expect(items.map((i) => i.status)).toEqual(["blocked", "dropped", "blocked"]);
      expect(fs.existsSync(path.join(dir, ".cursor/hooks.json"))).toBe(false);
    });

    it("maps beforeSubmitPrompt deny and allow", () => {
      const deny = wrapperOut("UserPromptSubmit", printing("", "no secrets", 2));
      expect(deny.status).toBe(0);
      expect(JSON.parse(deny.stdout)).toEqual({ continue: false, user_message: "no secrets" });
      const json = wrapperOut("UserPromptSubmit", printing(JSON.stringify({ decision: "block", reason: "nope" })));
      expect(JSON.parse(json.stdout)).toEqual({ continue: false, user_message: "nope" });
      expect(JSON.parse(wrapperOut("UserPromptSubmit", printing("")).stdout)).toEqual({ continue: true });
    });

    it("maps additionalContext to additional_context", () => {
      const out = printing(JSON.stringify({ hookSpecificOutput: { additionalContext: "hello" } }));
      for (const event of ["SessionStart", "PostToolUse", "PostToolUseFailure"]) {
        expect(JSON.parse(wrapperOut(event, out).stdout), event).toEqual({ additional_context: "hello" });
      }
      expect(wrapperOut("PostToolUse", printing("")).stdout).toBe("");
    });

    it("maps a Stop block to followup_message and allow to nothing", () => {
      for (const event of ["Stop", "SubagentStop"]) {
        const block = wrapperOut(event, printing(JSON.stringify({ decision: "block", reason: "keep going" })));
        expect(JSON.parse(block.stdout), event).toEqual({ followup_message: "keep going" });
        expect(wrapperOut(event, printing("")).stdout, event).toBe("");
      }
    });

    it("maps a subagentStart deny and allow", () => {
      expect(JSON.parse(wrapperOut("SubagentStart", printing("", "no", 2)).stdout)).toEqual({ permission: "deny", user_message: "no" });
      expect(JSON.parse(wrapperOut("SubagentStart", printing("")).stdout)).toEqual({ permission: "allow" });
    });

    it("prints nothing for sessionEnd and preCompact, exits 1 for a crash", () => {
      for (const event of ["SessionEnd", "PreCompact"]) {
        const r = wrapperOut(event, printing(JSON.stringify({ hookSpecificOutput: { additionalContext: "x" } })));
        expect([r.status, r.stdout], event).toEqual([0, ""]);
      }
      expect(wrapperOut("SessionEnd", printing("", "", 1)).status).toBe(1);
    });

    it("sends Claude field names to the command", () => {
      const seen = 'import{readFileSync,writeFileSync}from"node:fs";writeFileSync("seen.json",readFileSync(0,"utf-8"));';
      const dir = tmpDir();
      fs.writeFileSync(path.join(dir, "stub.mjs"), seen);
      cursorConverter.export(dir, configWith(hookFor("PostToolUse")), {});
      spawnSync("node", [WRAPPER], { cwd: dir, input: JSON.stringify({ tool_name: "Shell", tool_output: "x" }), encoding: "utf-8" });
      expect(JSON.parse(read(dir, "seen.json"))).toMatchObject({ tool_name: "Bash", tool_response: "x", hook_event_name: "PostToolUse" });
    });
  });
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Given, Then, When } from "@cucumber/cucumber";
import { cursorConverter } from "../../src/converters/cursor.js";
import type { FidelityItem, Hook, HarnessConfig } from "../../src/schema.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WRAPPER_REL = ".cursor/hooks/harnessport-guard-1.mjs";
const SHELL_PAYLOAD = '{"tool_name": "Shell", "tool_input": {"command": "ls"}}';

interface CursorWorld {
  config: HarnessConfig;
  items: FidelityItem[];
  outDir: string;
  src: string;
  before: Record<string, string>;
  run: { status: number | null; stdout: string; stderr: string };
}

const tmpDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "harnessport-bdd-"));
const readText = (root: string, rel: string): string => fs.readFileSync(path.join(root, rel), "utf-8");
const guardrail = (extra: Partial<Hook> = {}): HarnessConfig => ({
  rules: [], agents: [], skills: [], commands: [], mcpServers: [], permissions: [],
  hooks: [{ event: "PreToolUse", matcher: "Bash", command: "./guard.sh", ...extra }],
  formatters: [], items: [],
});

// Rewrites the scenario's JS-style object literal (unquoted keys) as JSON.
const parseLiteral = (literal: string): unknown =>
  JSON.parse(literal.replace(/([{,]\s*)([A-Za-z_]\w*):/g, '$1"$2":'));

function exportCursor(w: CursorWorld, force = false): void {
  w.items = cursorConverter.export(w.outDir, w.config, { force }).items;
}

function hookItem(w: CursorWorld, name: string): FidelityItem {
  const item = w.items.find((i) => i.kind === "hook" && i.name === name);
  assert.ok(item, JSON.stringify(w.items));
  return item;
}

// Generates a wrapper around `node stub.mjs`, where the stub is `stubSource`.
function wrapperFor(w: CursorWorld, command: string, stubSource?: string): void {
  w.outDir = tmpDir();
  if (stubSource !== undefined) fs.writeFileSync(path.join(w.outDir, "stub.mjs"), stubSource);
  w.config = guardrail({ command });
  exportCursor(w);
}

const stubPrinting = (stdout: string, stderr: string, code: number): string =>
  `process.stdout.write(${JSON.stringify(stdout)});process.stderr.write(${JSON.stringify(stderr)});process.exit(${code});`;

function runWrapper(w: CursorWorld, stdin: string): void {
  const r = spawnSync("node", [WRAPPER_REL], { cwd: w.outDir, input: stdin, encoding: "utf-8" });
  w.run = { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

// --- Givens: configs ---

Given(
  /^a canonical config holding a hook `\{event: "(\w+)", matcher: "(Bash\.\*)", command: "([^"]+)"\}`$/,
  function (this: CursorWorld, event: string, matcher: string, command: string) {
    this.config = { ...guardrail(), hooks: [{ event, matcher, command }] };
  },
);

Given(
  /^a canonical config holding a hook `\{event: "(\w+)", command: "([^"]+)", dialect: "(\w+)"\}`$/,
  function (this: CursorWorld, event: string, command: string, dialect: string) {
    this.config = { ...guardrail(), hooks: [{ event, command, dialect: dialect as Hook["dialect"] }] };
  },
);

// --- Givens: directories ---

Given(/^a directory where converting from claude to cursor has already run$/, function (this: CursorWorld) {
  this.outDir = tmpDir();
  this.config = guardrail();
  exportCursor(this);
});

Given(
  /^a target directory holding a `\.cursor\/hooks\.json` whose content differs from what the export would write$/,
  function (this: CursorWorld) {
    this.outDir = tmpDir();
    fs.mkdirSync(path.join(this.outDir, ".cursor"));
    fs.writeFileSync(path.join(this.outDir, ".cursor/hooks.json"), '{"version":1,"hooks":{}}');
    this.before = { ".cursor/hooks.json": '{"version":1,"hooks":{}}' };
    this.config = guardrail();
  },
);

Given(
  /^a directory holding `\.claude\/settings\.json` with a PreToolUse `Bash` guardrail$/,
  function (this: CursorWorld) {
    this.src = tmpDir();
    fs.mkdirSync(path.join(this.src, ".claude"));
    const settings = { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "./guard.sh" }] }] } };
    fs.writeFileSync(path.join(this.src, ".claude/settings.json"), `${JSON.stringify(settings, null, 4)}\n`);
    this.before = { ".claude/settings.json": readText(this.src, ".claude/settings.json") };
  },
);

// --- Givens: wrappers ---

Given(/^a wrapper generated for a command that writes its stdin to `seen\.json`$/, function (this: CursorWorld) {
  wrapperFor(
    this,
    "node stub.mjs",
    'import { readFileSync, writeFileSync } from "node:fs";writeFileSync("seen.json", readFileSync(0, "utf-8"));',
  );
});

Given(
  /^a wrapper generated for a command that prints `([^`]+)` to stderr and exits `(\d+)`$/,
  function (this: CursorWorld, stderr: string, code: string) {
    wrapperFor(this, "node stub.mjs", stubPrinting("", stderr, Number(code)));
  },
);

Given(/^a wrapper generated for a command that exits `0` and prints `([^`]+)`$/, function (this: CursorWorld, out: string) {
  wrapperFor(this, "node stub.mjs", stubPrinting(out, "", 0));
});

Given(
  /^a wrapper generated for a command that exits `0` and prints `permissionDecision: "ask"` in `hookSpecificOutput`$/,
  function (this: CursorWorld) {
    const out = { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask" } };
    wrapperFor(this, "node stub.mjs", stubPrinting(JSON.stringify(out), "", 0));
  },
);

Given(
  /^a wrapper generated for a command that exits `0` and prints `permissionDecision: "allow"` with `updatedInput: (\{.+\})`$/,
  function (this: CursorWorld, literal: string) {
    const out = {
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput: parseLiteral(literal) },
    };
    wrapperFor(this, "node stub.mjs", stubPrinting(JSON.stringify(out), "", 0));
  },
);

Given(/^a wrapper generated for a command that exits `0` and prints nothing$/, function (this: CursorWorld) {
  wrapperFor(this, "node stub.mjs", stubPrinting("", "", 0));
});

Given(/^a wrapper generated for a command that exits `(\d+)`$/, function (this: CursorWorld, code: string) {
  wrapperFor(this, "node stub.mjs", stubPrinting("", "", Number(code)));
});

Given(/^a wrapper generated for the command `([^`]+)`$/, function (this: CursorWorld, command: string) {
  wrapperFor(this, command);
});

// --- Whens ---

When(/^converting from claude to cursor into that directory without `--force`$/, function (this: CursorWorld) {
  exportCursor(this);
});

When(/^the same conversion runs again$/, function (this: CursorWorld) {
  this.before = {};
  const hooksDir = path.join(this.outDir, ".cursor/hooks");
  for (const rel of [".cursor/hooks.json", ...fs.readdirSync(hooksDir).map((f) => `.cursor/hooks/${f}`)]) {
    this.before[rel] = readText(this.outDir, rel);
  }
  exportCursor(this);
});

When(/^the wrapper is run with a Shell payload$/, function (this: CursorWorld) {
  runWrapper(this, SHELL_PAYLOAD);
});

When(/^the wrapper is run with a beforeShellExecution payload$/, function (this: CursorWorld) {
  runWrapper(this, '{"command": "ls", "cwd": "/w", "workspace_roots": ["/w"], "hook_event_name": "beforeShellExecution"}');
});

When(/^the wrapper is run with stdin `(.+)`$/, function (this: CursorWorld, stdin: string) {
  runWrapper(this, stdin);
});

// --- Thens: exported files ---

Then(/^`\.cursor\/hooks\.json` equals `(.+)`$/, function (this: CursorWorld, literal: string) {
  assert.deepEqual(JSON.parse(readText(this.outDir, ".cursor/hooks.json")), parseLiteral(literal));
});

Then(
  /^the file `([^`]+)` exists and contains the string `([^`]+)`$/,
  function (this: CursorWorld, rel: string, text: string) {
    assert.ok(readText(this.outDir, rel).includes(text));
  },
);

Then(/^no file `([^`]+)` is written$/, function (this: CursorWorld, rel: string) {
  assert.ok(!fs.existsSync(path.join(this.outDir, rel)));
});

Then(/^no wrapper file is written for it$/, function (this: CursorWorld) {
  assert.ok(!fs.existsSync(path.join(this.outDir, ".cursor/hooks")));
});

Then(
  /^`hooks\.beforeShellExecution\[0\]` in `\.cursor\/hooks\.json` has no `failClosed` key and no `timeout` key$/,
  function (this: CursorWorld) {
    const entry = (JSON.parse(readText(this.outDir, ".cursor/hooks.json")) as { hooks: { beforeShellExecution: object[] } }).hooks.beforeShellExecution[0];
    assert.ok(!("failClosed" in entry) && !("timeout" in entry), JSON.stringify(entry));
  },
);

Then(/^`hooks\.(\w+)\[0\]\.matcher` equals `([^`]+)`$/, function (this: CursorWorld, event: string, matcher: string) {
  const cursorFile = path.join(this.outDir, ".cursor/hooks.json");
  const json = JSON.parse(
    fs.existsSync(cursorFile) ? fs.readFileSync(cursorFile, "utf-8") : readText(this.outDir, ".claude/settings.json"),
  ) as { hooks: Record<string, Array<{ matcher: string }>> };
  assert.equal(json.hooks[event][0].matcher, matcher);
});

Then(/^`\.cursor\/hooks\.json` and every wrapper file are byte-identical$/, function (this: CursorWorld) {
  for (const [rel, content] of Object.entries(this.before)) {
    assert.equal(readText(this.outDir, rel), content);
  }
  assert.ok(Object.keys(this.before).some((rel) => rel.endsWith(".mjs")));
});

Then(/^no item has status `blocked`$/, function (this: CursorWorld) {
  assert.ok(this.items.every((i) => i.status !== "blocked"), JSON.stringify(this.items));
});

Then(/^`\.claude\/settings\.json` is byte-identical to its content before the run$/, function (this: CursorWorld) {
  assert.equal(readText(this.src, ".claude/settings.json"), this.before[".claude/settings.json"]);
});

// --- Thens: items ---

Then(
  /^the item of kind `hook` named `(\w+)` has status `(\w+)` and its reason names (.+)$/,
  function (this: CursorWorld, name: string, status: string, text: string) {
    const item = hookItem(this, name);
    assert.equal(item.status, status, JSON.stringify(item));
    assert.ok(item.reason?.includes(text.replaceAll("`", "")), JSON.stringify(item));
  },
);

Then(/^its reason names `\.claude\/settings\.json`$/, function (this: CursorWorld) {
  const item = this.items.find((i) => i.kind === "hook");
  assert.ok(item?.reason?.includes(".claude/settings.json"), JSON.stringify(this.items));
});

Then(/^an item names `([^`]+)` with status `(\w+)`$/, function (this: CursorWorld, rel: string, status: string) {
  const item = this.items.find((i) => i.name.endsWith(rel) && i.status === status);
  assert.ok(item, JSON.stringify(this.items));
});

// The shared CLI step records no items, so this runs the CLI again with --json.
Then(
  /^the item of kind `hook` named `(\w+)` has a reason containing `([^`]+)`$/,
  function (this: CursorWorld, name: string, text: string) {
    const r = spawnSync(
      "npx",
      ["tsx", "src/index.ts", "convert", "--from", "claude", "--to", "cursor", "--source", this.src, "--target", path.join(tmpDir(), "out"), "--json"],
      { cwd: ROOT, encoding: "utf-8" },
    );
    this.items = (JSON.parse(r.stdout) as { items: FidelityItem[] }).items;
    assert.ok(hookItem(this, name).reason?.includes(text), JSON.stringify(this.items));
  },
);

// --- Thens: wrapper runs ---

Then(
  /^`seen\.json` holds `tool_name` equal to `(\w+)`(?: and `tool_input\.(command|prompt)` equal to `([^`]+)`)?$/,
  function (this: CursorWorld, tool: string, field?: string, value?: string) {
    const seen = JSON.parse(readText(this.outDir, "seen.json")) as { tool_name: string; tool_input: Record<string, string> };
    assert.equal(seen.tool_name, tool);
    // Cucumber passes null for an unmatched optional group.
    if (field != null && value != null) assert.equal(seen.tool_input[field], value);
  },
);

Then(/^the wrapper exits `(\d+)`$/, function (this: CursorWorld, code: string) {
  assert.equal(this.run.status, Number(code), JSON.stringify(this.run));
});

Then(
  /^the wrapper exits `(\d+)` and its stderr contains `([^`]+)`$/,
  function (this: CursorWorld, code: string, stderr: string) {
    assert.equal(this.run.status, Number(code), JSON.stringify(this.run));
    assert.ok(this.run.stderr.includes(stderr), this.run.stderr);
  },
);

Then(/^the wrapper stderr contains `([^`]+)`$/, function (this: CursorWorld, stderr: string) {
  assert.ok(this.run.stderr.includes(stderr), this.run.stderr);
});

Then(/^the wrapper exits `(\d+)` and prints nothing on stdout$/, function (this: CursorWorld, code: string) {
  assert.equal(this.run.status, Number(code), JSON.stringify(this.run));
  assert.equal(this.run.stdout, "");
});

Then(
  /^the wrapper stdout parses to `(\{.+\})`(?: and the wrapper exits `(\d+)`)?$/,
  function (this: CursorWorld, literal: string, code?: string) {
    assert.deepEqual(JSON.parse(this.run.stdout), JSON.parse(literal));
    assert.equal(this.run.status, Number(code ?? 0));
  },
);

Then(/^the wrapper stdout parses to a `permission` of `ask` and the wrapper exits `0`$/, function (this: CursorWorld) {
  assert.equal(JSON.parse(this.run.stdout).permission, "ask");
  assert.equal(this.run.status, 0);
});

// --- User-level target: the wrapper path is absolute ---

Given(
  /^a canonical config holding a hook `\{event: "(\w+)", matcher: "(\w+)", command: "([^"]+)"\}` and a home directory passed to the exporter$/,
  function (this: CursorWorld, event: string, matcher: string, command: string) {
    this.config = { ...guardrail(), hooks: [{ event, matcher, command }] };
    this.outDir = tmpDir();
  },
);

When(/^converting from claude to cursor with the target equal to that home directory$/, function (this: CursorWorld) {
  this.items = cursorConverter.export(this.outDir, this.config, { homeDir: this.outDir } as Parameters<typeof cursorConverter.export>[2]).items;
});

Then(
  /^`hooks\.beforeShellExecution\[0\]\.command` in `\.cursor\/hooks\.json` equals `node "<absolute path>\/\.cursor\/hooks\/harnessport-guard-1\.mjs"`, with the path in double quotes$/,
  function (this: CursorWorld) {
    const json = JSON.parse(readText(this.outDir, ".cursor/hooks.json"));
    assert.equal(json.hooks.beforeShellExecution[0].command, `node "${path.join(this.outDir, WRAPPER_REL)}"`);
  },
);

Then(
  /^converting into any other directory still writes `node \.cursor\/hooks\/harnessport-guard-1\.mjs`$/,
  function (this: CursorWorld) {
    const other = tmpDir();
    cursorConverter.export(other, this.config, {});
    const json = JSON.parse(readText(other, ".cursor/hooks.json"));
    assert.equal(json.hooks.beforeShellExecution[0].command, `node ${WRAPPER_REL}`);
  },
);

// --- Non-PreToolUse events ---

Given(
  /^a `(\w+)` wrapper generated for a command that exits `(\d+)`, prints `([^`]*)` to stdout and `([^`]*)` to stderr$/,
  function (this: CursorWorld, event: string, code: string, stdout: string, stderr: string) {
    this.outDir = tmpDir();
    fs.writeFileSync(path.join(this.outDir, "stub.mjs"), stubPrinting(stdout, stderr, Number(code)));
    this.config = guardrail({ event, matcher: undefined, command: "node stub.mjs" });
    exportCursor(this);
  },
);

Given(
  /^a `(\w+)` wrapper generated for a command that writes its stdin to `seen\.json`$/,
  function (this: CursorWorld, event: string) {
    this.outDir = tmpDir();
    fs.writeFileSync(
      path.join(this.outDir, "stub.mjs"),
      'import { readFileSync, writeFileSync } from "node:fs";writeFileSync("seen.json", readFileSync(0, "utf-8"));',
    );
    this.config = guardrail({ event, matcher: undefined, command: "node stub.mjs" });
    exportCursor(this);
  },
);

Then(/^`seen\.json` holds `(tool_response|hook_event_name)` equal to `(\w+)`$/, function (this: CursorWorld, key: string, value: string) {
  assert.equal(JSON.parse(readText(this.outDir, "seen.json"))[key], value);
});

Given(
  /^a canonical config holding a hook `\{event: "(\w+)", command: "([^"]+)", failClosed: true\}`$/,
  function (this: CursorWorld, event: string, command: string) {
    this.config = guardrail({ event, matcher: undefined, command, failClosed: true });
  },
);

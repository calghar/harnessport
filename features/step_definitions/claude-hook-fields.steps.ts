import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Given, Then, When } from "@cucumber/cucumber";
import { claudeConverter } from "../../src/converters/claude.js";
import type { FidelityItem, HarnessConfig } from "../../src/schema.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

interface HookFieldsWorld {
  config: HarnessConfig;
  items: FidelityItem[];
  outDir: string;
  status: number | null;
  stderr: string;
  src: string;
  before: Record<string, string>;
  cli: { items: FidelityItem[] };
}

const tmpDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "harnessport-bdd-"));

function writeFile(root: string, rel: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content);
}

// Rewrites the scenario's JS-style object literal (unquoted keys) as JSON.
const parseLiteral = (literal: string): unknown =>
  JSON.parse(literal.replace(/([{,]\s*)([A-Za-z_]\w*):/g, '$1"$2":'));

function seedHandler(w: HookFieldsWorld, event: string, handler: unknown): void {
  w.src = w.outDir = tmpDir();
  writeFile(w.src, ".claude/settings.json", JSON.stringify({ hooks: { [event]: [{ hooks: [handler] }] } }));
  w.config = claudeConverter.import(w.src);
}

function runCli(w: HookFieldsWorld, args: string[]): void {
  const r = spawnSync("npx", ["tsx", "src/index.ts", "convert", ...args], { cwd: ROOT, encoding: "utf-8" });
  w.status = r.status;
  w.stderr = r.stderr;
}

Given(
  /^`\.claude\/settings\.json` holding a PreToolUse handler `(\{command: "\.\/guard\.sh", onFailure: "continue"\})` with no `type`$/,
  function (this: HookFieldsWorld, literal: string) {
    seedHandler(this, "PreToolUse", parseLiteral(literal));
  },
);

Given(
  /^`\.claude\/settings\.json` holding a (PreToolUse|Stop) handler `(\{type: "[^`]+\})`$/,
  function (this: HookFieldsWorld, event: string, literal: string) {
    seedHandler(this, event, parseLiteral(literal));
  },
);

Given(
  /^`\.claude\/settings\.json` holding `hooks\.PreToolUse\[0\] = (\{.*\})`$/,
  function (this: HookFieldsWorld, literal: string) {
    this.src = this.outDir = tmpDir();
    writeFile(this.src, ".claude/settings.json", JSON.stringify({ hooks: { PreToolUse: [parseLiteral(literal)] } }));
    this.config = claudeConverter.import(this.src);
  },
);

Then(
  /^the canonical config holds a hook `\{event: "(\w+)", command: "([^"]+)"\}` with no `failClosed`$/,
  function (this: HookFieldsWorld, event: string, command: string) {
    assert.equal(this.config.hooks.length, 1);
    assert.equal(this.config.hooks[0].event, event);
    assert.equal(this.config.hooks[0].command, command);
    assert.equal(this.config.hooks[0].failClosed, undefined);
  },
);

Then(
  /^the emitted `\.claude\/settings\.json` holds that handler with `args: \["--strict"\]`, `timeout: 10` and `onFailure: "block"`$/,
  function (this: HookFieldsWorld) {
    const json = JSON.parse(fs.readFileSync(path.join(this.outDir, ".claude/settings.json"), "utf-8"));
    assert.deepEqual(json.hooks.PreToolUse[0], {
      hooks: [{ type: "command", command: "guard", args: ["--strict"], timeout: 10, onFailure: "block" }],
      matcher: "Bash",
    });
  },
);

Then(
  /^an import item of kind `hook` named `(\w+)` has status `(\w+)`(?: and its reason names `(\w+)`)?$/,
  function (this: HookFieldsWorld, name: string, status: string, type?: string) {
    const item = this.config.items.find((i) => i.kind === "hook" && i.name === name && i.phase === "import");
    assert.equal(item?.status, status, JSON.stringify(this.config.items));
    if (type) assert.match(item?.reason ?? "", new RegExp(type));
  },
);

Then(/^its reason states that the hook fires on every matcher hit$/, function (this: HookFieldsWorld) {
  const item = this.config.items.find((i) => i.kind === "hook" && i.status === "lossy");
  assert.match(item?.reason ?? "", /fires on every matcher hit/);
});

Then(/^the canonical config holds no hook with an undefined `command`$/, function (this: HookFieldsWorld) {
  assert.ok(this.config.hooks.every((h) => typeof h.command === "string"));
  // The scenario's exit step reads the real CLI result for the same source.
  runCli(this, ["--from", "claude", "--to", "copilot", "--source", this.src, "--target", path.join(tmpDir(), "out")]);
});

Given(
  /^a directory holding `\.claude\/settings\.json` with a PreToolUse `Bash` guardrail and `\.claude\/settings\.local\.json` with a `deny` permission$/,
  function (this: HookFieldsWorld) {
    this.src = this.outDir = tmpDir();
    const settings = { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "./guard.sh" }] }] } };
    writeFile(this.src, ".claude/settings.json", `${JSON.stringify(settings, null, 4)}\n`);
    writeFile(this.src, ".claude/settings.local.json", '{"permissions":{"deny":["Bash(rm *)"]}}');
    this.before = Object.fromEntries(
      [".claude/settings.json", ".claude/settings.local.json"].map((f) => [f, fs.readFileSync(path.join(this.src, f), "utf-8")]),
    );
  },
);

When(/^converting from claude to cursor with no `--target`$/, function (this: HookFieldsWorld) {
  runCli(this, ["--from", "claude", "--to", "cursor", "--source", this.src]);
});

Then(/^both files are byte-identical to their content before the run$/, function (this: HookFieldsWorld) {
  for (const [rel, content] of Object.entries(this.before)) {
    assert.equal(fs.readFileSync(path.join(this.src, rel), "utf-8"), content);
  }
});

Given(
  /^a target directory holding a `\.claude\/settings\.json` whose content differs from what the export would write$/,
  function (this: HookFieldsWorld) {
    this.outDir = tmpDir();
    writeFile(this.outDir, ".claude/settings.json", '{"hooks":{"Stop":[]}}');
    this.before = { ".claude/settings.json": '{"hooks":{"Stop":[]}}' };
  },
);

When(
  /^converting from copilot to claude into that directory without `--force`$/,
  function (this: HookFieldsWorld) {
    const r = spawnSync(
      "npx",
      ["tsx", "src/index.ts", "convert", "--from", "copilot", "--to", "claude", "--source", path.join(ROOT, "tests/fixtures/copilot-project"), "--target", this.outDir, "--json"],
      { cwd: ROOT, encoding: "utf-8" },
    );
    this.status = r.status;
    this.cli = JSON.parse(r.stdout);
  },
);

Then(/^the file is byte-identical to its content before the run$/, function (this: HookFieldsWorld) {
  for (const [rel, content] of Object.entries(this.before)) {
    assert.equal(fs.readFileSync(path.join(this.outDir, rel), "utf-8"), content);
  }
});

Then(/^an item names that path with status `blocked`$/, function (this: HookFieldsWorld) {
  const item = this.cli.items.find((i) => i.status === "blocked" && i.name.includes("settings.json"));
  assert.ok(item, JSON.stringify(this.cli.items));
});

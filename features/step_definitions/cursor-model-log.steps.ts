import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Given, Then, When } from "@cucumber/cucumber";
import { claudeConverter } from "../../src/converters/claude.js";
import { cursorConverter } from "../../src/converters/cursor.js";
import type { FidelityItem, HarnessConfig } from "../../src/schema.js";

const TSX = path.resolve("node_modules/.bin/tsx");
const CLI = path.resolve("src/index.ts");
const SAMPLE = path.resolve("tests/fixtures/sample-project");
const WRAPPER = ".cursor/hooks/harnessport-model-log.mjs";
const LOG = ".cursor/harnessport-model.jsonl";

interface ModelLogWorld {
  dir: string;
  items: FidelityItem[];
  run: { status: number | null; stdout: string; stderr: string };
  written: Record<string, string>;
  expected: Record<string, string>;
}

const tmpDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "harnessport-modellog-bdd-"));
const read = (dir: string, rel: string): string => fs.readFileSync(path.join(dir, rel), "utf-8");
const config = (stopCommand?: string): HarnessConfig => ({
  rules: [], agents: [], skills: [], commands: [], mcpServers: [], permissions: [],
  hooks: stopCommand ? [{ event: "Stop", command: stopCommand }] : [],
  formatters: [], items: [],
});
const claudeProject = (): string => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, ".claude"));
  fs.writeFileSync(path.join(dir, ".claude", "settings.json"), "{}");
  return dir;
};
const snapshot = (dir: string): Record<string, string> =>
  Object.fromEntries(
    fs.readdirSync(dir, { recursive: true, encoding: "utf-8" })
      .filter((f) => fs.statSync(path.join(dir, f)).isFile())
      .map((f) => [f, read(dir, f)]),
  );
const cli = (w: ModelLogWorld, ...args: string[]): void => {
  w.run = spawnSync(TSX, [CLI, "convert", ...args], { encoding: "utf-8" });
};
const runWrapper = (w: ModelLogWorld, input: string): void => {
  w.run = spawnSync("node", [WRAPPER], { cwd: w.dir, input, encoding: "utf-8" });
};

Given("a Claude project with no hooks", function (this: ModelLogWorld) {
  this.dir = claudeProject();
});

Given("a Claude project", function (this: ModelLogWorld) {
  this.dir = claudeProject();
  this.written = snapshot(this.dir);
});

Given("a Claude project with one `Stop` hook", function (this: ModelLogWorld) {
  this.dir = tmpDir();
});

Given("the export target is the home directory", function (this: ModelLogWorld) {
  this.dir = tmpDir();
});

Given("the `sample-project` fixture with Claude hooks and permissions", function (this: ModelLogWorld) {
  this.dir = tmpDir();
});

Given("a generated model-log wrapper", function (this: ModelLogWorld) {
  this.dir = tmpDir();
  cursorConverter.export(this.dir, config(), { logModel: true });
});

Given("a Cursor project exported with `--log-model`", function (this: ModelLogWorld) {
  this.dir = tmpDir();
  cursorConverter.export(this.dir, config(), { logModel: true });
});

When(
  /^`harnessport convert --from claude --to cursor --log-model( --dry-run)?` runs on it$/,
  function (this: ModelLogWorld, dry?: string) {
    cli(this, "--from", "claude", "--to", "cursor", "--source", this.dir, "--log-model", "--json", ...(dry ? ["--dry-run"] : []));
    if (!dry) this.items = JSON.parse(this.run.stdout).items;
  },
);

When("the Cursor export runs with the model log requested", function (this: ModelLogWorld) {
  cursorConverter.export(this.dir, config(), { logModel: true, homeDir: this.dir });
});

When("the Cursor export runs with `--log-model`", function (this: ModelLogWorld) {
  cursorConverter.export(this.dir, config("./stop.sh"), { logModel: true });
});

When("`harnessport convert --from claude --to cursor` runs without `--log-model`", function (this: ModelLogWorld) {
  const imported = claudeConverter.import(SAMPLE);
  const before = tmpDir();
  cursorConverter.export(before, imported, {});
  this.expected = snapshot(before);
  cursorConverter.export(this.dir, imported, { logModel: false });
  this.written = snapshot(this.dir);
});

When(
  "it receives a stop payload with `conversation_id` `{word}`, `generation_id` `{word}`, `model` `{word}` and `model_id` `{word}`",
  function (this: ModelLogWorld, conversation: string, generation: string, model: string, modelId: string) {
    const payload: Record<string, string> = { conversation_id: conversation, generation_id: generation, model, model_id: modelId };
    if (generation === "(absent)") delete payload.generation_id;
    runWrapper(this, JSON.stringify(payload));
  },
);

When("it runs with a read-only .cursor directory", function (this: ModelLogWorld) {
  fs.chmodSync(path.join(this.dir, ".cursor"), 0o555);
  runWrapper(this, '{"model":"m"}');
  fs.chmodSync(path.join(this.dir, ".cursor"), 0o755);
});

When("it runs with stdin that is not JSON", function (this: ModelLogWorld) {
  runWrapper(this, "nope");
});

When("it runs with stdin that is a JSON array", function (this: ModelLogWorld) {
  runWrapper(this, "[1]");
});

When("`harnessport convert --from claude --to codex --log-model` runs on it", function (this: ModelLogWorld) {
  cli(this, "--from", "claude", "--to", "codex", "--source", this.dir, "--log-model");
});

When("`harnessport convert --from cursor --to claude` runs on it", function (this: ModelLogWorld) {
  cli(this, "--from", "cursor", "--to", "claude", "--source", this.dir, "--json");
  this.items = JSON.parse(this.run.stdout).items;
});

Then(/^`\.cursor\/hooks\/harnessport-model-log\.mjs` exists$/, function (this: ModelLogWorld) {
  assert.ok(fs.existsSync(path.join(this.dir, WRAPPER)));
});

Then(/^`\.cursor\/hooks\.json` `hooks\.stop` holds an entry with command `([^`]+)`$/, function (this: ModelLogWorld, command: string) {
  assert.ok(JSON.parse(read(this.dir, ".cursor/hooks.json")).hooks.stop.some((e: { command: string }) => e.command === command));
});

Then("the fidelity report holds a `model-log` item with status `exact`", function (this: ModelLogWorld) {
  assert.ok(this.items.some((i) => i.name === "model-log" && i.status === "exact"));
});

Then(/^the `hooks\.stop` entry command is `node "<home>\/\.cursor\/hooks\/harnessport-model-log\.mjs"`$/, function (this: ModelLogWorld) {
  const [entry] = JSON.parse(read(this.dir, ".cursor/hooks.json")).hooks.stop;
  assert.equal(entry.command, `node "${path.join(this.dir, WRAPPER)}"`);
});

Then(/^no file is created under `\.cursor\/`$/, function (this: ModelLogWorld) {
  assert.ok(!fs.existsSync(path.join(this.dir, ".cursor")));
});

Then("every written file is byte-identical to the committed expected output", function (this: ModelLogWorld) {
  assert.deepEqual(this.written, this.expected);
});

Then("no written file contains the text `harnessport-model-log`", function (this: ModelLogWorld) {
  for (const content of Object.values(this.written)) assert.ok(!content.includes("harnessport-model-log"));
});

Then(/^`\.cursor\/harnessport-model\.jsonl` gains exactly one line$/, function (this: ModelLogWorld) {
  assert.equal(read(this.dir, LOG).split("\n").filter(Boolean).length, 1);
});

Then("the line parses as JSON with a `timestamp` string ending in `Z`", function (this: ModelLogWorld) {
  assert.match(JSON.parse(read(this.dir, LOG)).timestamp, /Z$/);
});

Then(/^the line holds exactly the keys `([^`]+)`$/, function (this: ModelLogWorld, keys: string) {
  assert.deepEqual(Object.keys(JSON.parse(read(this.dir, LOG))), keys.split(","));
});

Then("its exit status is 0", function (this: ModelLogWorld) {
  assert.equal(this.run.status, 0);
});

Then("its stdout is empty", function (this: ModelLogWorld) {
  assert.equal(this.run.stdout, "");
});

Then("its stderr is one line starting with `harnessport-model-log:`", function (this: ModelLogWorld) {
  // root ignores directory modes, so a read-only case cannot fail there
  if (this.run.stderr === "" && process.getuid?.() === 0) return;
  assert.match(this.run.stderr, /^harnessport-model-log: [^\n]*\n$/);
});

Then("the exit status is 1", function (this: ModelLogWorld) {
  assert.equal(this.run.status, 1);
});

Then("stderr contains `--log-model`", function (this: ModelLogWorld) {
  assert.ok(this.run.stderr.includes("--log-model"));
});

Then("no file is written in the project", function (this: ModelLogWorld) {
  assert.deepEqual(snapshot(this.dir), this.written);
});

Then(/^`\.claude\/settings\.json` holds no `Stop` hook running `harnessport-model-log`$/, function (this: ModelLogWorld) {
  const file = path.join(this.dir, ".claude/settings.json");
  assert.ok(!fs.existsSync(file) || !read(this.dir, ".claude/settings.json").includes("harnessport-model-log"));
});

Then("the fidelity report holds one `dropped` item with that reason", function (this: ModelLogWorld) {
  const reason = "the harnessport model log is Cursor-only and has no Claude hook mapping";
  assert.equal(this.items.filter((i) => i.status === "dropped" && i.reason?.includes(reason)).length, 1);
});

Then(
  /^`hooks\.stop` holds two entries, `node \.cursor\/hooks\/harnessport-guard-1\.mjs` then `node \.cursor\/hooks\/harnessport-model-log\.mjs`$/,
  function (this: ModelLogWorld) {
    const commands = JSON.parse(read(this.dir, ".cursor/hooks.json")).hooks.stop.map((e: { command: string }) => e.command);
    assert.deepEqual(commands, ["node .cursor/hooks/harnessport-guard-1.mjs", `node ${WRAPPER}`]);
  },
);

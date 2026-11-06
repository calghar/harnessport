import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Given, Then, When } from "@cucumber/cucumber";
import { claudeConverter } from "../../src/converters/claude.js";
import type { FidelityItem, HarnessConfig } from "../../src/schema.js";

const RUNNER_REL = ".claude/hooks/harnessport-format.mjs";
const RECORD_STUB =
  'import { writeFileSync } from "node:fs";writeFileSync("recorded.txt", process.argv.at(-1));';

interface FormatterWorld {
  config: HarnessConfig;
  items: FidelityItem[];
  outDir: string;
  glob: string;
  command: string;
  run: { status: number | null };
}

const tmpDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "harnessport-bdd-"));
const withFormatter = (glob: string, command: string): HarnessConfig => ({
  rules: [], agents: [], skills: [], commands: [], mcpServers: [], permissions: [], hooks: [],
  formatters: [{ glob, command }], items: [],
});

function emitRunner(w: FormatterWorld, glob: string, command: string): void {
  w.outDir = tmpDir();
  w.glob = glob;
  w.command = command;
  fs.writeFileSync(path.join(w.outDir, "record.mjs"), RECORD_STUB);
  claudeConverter.export(w.outDir, withFormatter(glob, command));
}

Given(
  /^a canonical config holding a formatter `\{glob: "([^"]+)", command: "([^"]+)"\}`$/,
  function (this: FormatterWorld, glob: string, command: string) {
    this.config = withFormatter(glob, command);
  },
);

Given(
  /^the emitted `\.claude\/hooks\/harnessport-format\.mjs` with glob `([^`]+)` and a formatter command `([^`]+)` that writes its last argument to a file$/,
  function (this: FormatterWorld, glob: string, command: string) {
    emitRunner(this, glob, command);
  },
);

Given(
  /^the emitted runner(?: with glob `([^`]+)`)? and a formatter command that writes a file when run$/,
  function (this: FormatterWorld, glob?: string) {
    emitRunner(this, glob ?? "*", "node record.mjs");
  },
);

Given(/^`\.claude\/settings\.json` written by the first scenario$/, function (this: FormatterWorld) {
  this.outDir = tmpDir();
  claudeConverter.export(this.outDir, withFormatter("*.ts", "biome format --write"));
});

Given(
  /^a target directory holding `\.claude\/hooks\/harnessport-format\.mjs` whose content differs from the runner the export would write$/,
  function (this: FormatterWorld) {
    this.outDir = tmpDir();
    fs.mkdirSync(path.join(this.outDir, ".claude/hooks"), { recursive: true });
    fs.writeFileSync(path.join(this.outDir, RUNNER_REL), "// user runner\n");
    (this as unknown as { before: Record<string, string> }).before = { [RUNNER_REL]: "// user runner\n" };
    this.config = withFormatter("*.ts", "biome format --write");
  },
);

When(/^exporting a formatter to claude into that directory without `--force`$/, function (this: FormatterWorld) {
  this.items = claudeConverter.export(this.outDir, this.config).items;
});

When(/^the runner is run with stdin `(.+)`$/, function (this: FormatterWorld, stdin: string) {
  const r = spawnSync("node", [RUNNER_REL, this.glob, ...this.command.split(/\s+/)], {
    cwd: this.outDir,
    input: stdin,
    encoding: "utf-8",
  });
  this.run = { status: r.status };
});

Then(/^the file `([^`]+)` exists$/, function (this: FormatterWorld, rel: string) {
  assert.ok(fs.existsSync(path.join(this.outDir, rel)));
});

Then(
  /^`\.claude\/settings\.json` holds `hooks\.PostToolUse\[0\]\.hooks\[0\]\.command` equal to `([^`]+)`$/,
  function (this: FormatterWorld, command: string) {
    const json = JSON.parse(fs.readFileSync(path.join(this.outDir, ".claude/settings.json"), "utf-8")) as {
      hooks: { PostToolUse: Array<{ hooks: Array<{ command: string }> }> };
    };
    assert.equal(json.hooks.PostToolUse[0].hooks[0].command, command);
  },
);

Then(/^the recorded argument equals `([^`]+)`$/, function (this: FormatterWorld, arg: string) {
  assert.equal(fs.readFileSync(path.join(this.outDir, "recorded.txt"), "utf-8"), arg);
});

Then(/^the runner exits `(\d+)`$/, function (this: FormatterWorld, code: string) {
  assert.equal(this.run.status, Number(code));
});

Then(/^no file is written$/, function (this: FormatterWorld) {
  assert.ok(!fs.existsSync(path.join(this.outDir, "recorded.txt")));
});

Then(
  /^the canonical config holds one formatter with glob `([^`]+)` and command `([^`]+)`$/,
  function (this: FormatterWorld, glob: string, command: string) {
    assert.deepEqual(this.config.formatters, [{ glob, command }]);
  },
);

Then(/^holds no hook whose command contains `([^`]+)`$/, function (this: FormatterWorld, text: string) {
  assert.ok(this.config.hooks.every((h) => !h.command.includes(text)));
});

Then(
  /^the item of kind `formatter` has status `dropped` and its reason names the `(.)` character$/,
  function (this: FormatterWorld, char: string) {
    const item = this.items.find((i) => i.kind === "formatter");
    assert.equal(item?.status, "dropped", JSON.stringify(this.items));
    assert.ok(item?.reason?.includes(`\`${char}\``), item?.reason);
  },
);

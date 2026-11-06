import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Given, Then, When } from "@cucumber/cucumber";
import { claudeConverter } from "../../src/converters/claude.js";
import { codexConverter } from "../../src/converters/codex.js";
import { copilotConverter } from "../../src/converters/copilot.js";
import { cursorConverter } from "../../src/converters/cursor.js";
import { opencodeConverter } from "../../src/converters/opencode.js";
import type { Converter } from "../../src/converters/types.js";
import type { FidelityItem, HarnessConfig } from "../../src/schema.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CONVERTERS: Record<string, Converter> = {
  claude: claudeConverter,
  codex: codexConverter,
  copilot: copilotConverter,
  cursor: cursorConverter,
  opencode: opencodeConverter,
};

interface PreservedWorld {
  config: HarnessConfig;
  items: FidelityItem[];
  outDir: string;
}

const emptyConfig = (): HarnessConfig => ({
  rules: [], agents: [], skills: [], commands: [],
  mcpServers: [], permissions: [], hooks: [], formatters: [], items: [],
});

const tmpDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "harnessport-bdd-"));
const readJson = (file: string): unknown => JSON.parse(fs.readFileSync(file, "utf-8"));

function exportTo(w: PreservedWorld, target: string): void {
  w.outDir = tmpDir();
  const result = CONVERTERS[target].export(w.outDir, w.config);
  w.items = result.items;
}

Given(
  /^a canonical config holding a hook `\{event: "(\w+)", matcher: "(\w+)", command: "([^"]+)"\}`(?: with no other field)?$/,
  function (this: PreservedWorld, event: string, matcher: string, command: string) {
    this.config = { ...emptyConfig(), hooks: [{ event, matcher, command }] };
  },
);

Given(
  /^a canonical config holding one formatter(?: `\{glob: "([^"]+)", command: "([^"]+)"\}` and one PostToolUse hook)?$/,
  function (this: PreservedWorld, glob?: string, command?: string) {
    const hooks = glob ? [{ event: "PostToolUse", matcher: "Bash", command: "./log.sh" }] : [];
    this.config = {
      ...emptyConfig(),
      hooks,
      formatters: [{ glob: glob ?? "*.ts", command: command ?? "prettier --write" }],
    };
  },
);

Given(
  /^`\.claude\/settings\.json` holding a PostToolUse handler `\{matcher: "([^"]+)", hooks: \[\{type: "command", command: "([^"]+)"\}\]\}`$/,
  function (this: PreservedWorld, matcher: string, command: string) {
    this.outDir = tmpDir();
    fs.mkdirSync(path.join(this.outDir, ".claude"));
    const handler = { matcher, hooks: [{ type: "command", command }] };
    fs.writeFileSync(
      path.join(this.outDir, ".claude/settings.json"),
      JSON.stringify({ hooks: { PostToolUse: [handler] } }),
    );
  },
);

Given(
  /^`tests\/fixtures\/copilot-project\/\.github\/hooks\/hooks\.json` in the bare form `.*`$/,
  function (this: PreservedWorld) {
    this.outDir = path.join(ROOT, "tests/fixtures/copilot-project");
  },
);

When(
  /^(?:exporting|converting from \w+) to (\w+)(?: into a new directory)?$/,
  function (this: PreservedWorld, target: string) {
    exportTo(this, target);
  },
);

When(/^importing from (\w+)$/, function (this: PreservedWorld, source: string) {
  this.config = CONVERTERS[source].import(this.outDir);
});

Then(
  /^the emitted `opencode\.json` carries the same `formatter` key as before this change$/,
  function (this: PreservedWorld) {
    const json = readJson(path.join(this.outDir, "opencode.json")) as { formatter?: unknown };
    assert.deepEqual(json.formatter, {
      prettier: { command: ["prettier", "--write", "$FILE"], extensions: [".ts"] },
    });
  },
);

Then(
  /^the item of kind `(\w+)` has status `(\w+)`$/,
  function (this: PreservedWorld, kind: string, status: string) {
    const item = this.items.find((i) => i.kind === kind);
    assert.equal(item?.status, status, JSON.stringify(this.items));
  },
);

Then(
  /^the item of kind `hook` named `(\w+)` has status `(\w+)`$/,
  function (this: PreservedWorld, name: string, status: string) {
    const item = this.items.find((i) => i.kind === "hook" && i.name === name);
    assert.equal(item?.status, status, JSON.stringify(this.items));
  },
);

Then(
  /^`\.claude\/settings\.json` holds `hooks\.PreToolUse\[0\]` equal to `.*`$/,
  function (this: PreservedWorld) {
    const json = readJson(path.join(this.outDir, ".claude/settings.json")) as {
      hooks: { PreToolUse: unknown[] };
    };
    assert.deepEqual(json.hooks.PreToolUse[0], {
      hooks: [{ type: "command", command: "./guard.sh" }],
      matcher: "Bash",
    });
  },
);

Then(
  /^`\.codex\/hooks\.json` equals `.*`$/,
  function (this: PreservedWorld) {
    assert.deepEqual(readJson(path.join(this.outDir, ".codex/hooks.json")), {
      hooks: {
        PreToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: "./guard.sh" }] },
        ],
      },
    });
  },
);

Then(
  /^the canonical config holds one hook `\{event: "(\w+)", command: "([^"]+)"\}`$/,
  function (this: PreservedWorld, event: string, command: string) {
    assert.equal(this.config.hooks.length, 1);
    assert.equal(this.config.hooks[0].event, event);
    assert.equal(this.config.hooks[0].command, command);
  },
);

Then(
  /^the canonical config holds one formatter with command `([^`]+)`$/,
  function (this: PreservedWorld, command: string) {
    assert.equal(this.config.formatters.length, 1);
    assert.equal(this.config.formatters[0].command, command);
  },
);

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Given, Then, When } from "@cucumber/cucumber";
import { cursorConverter } from "../../src/converters/cursor.js";
import type { FidelityItem, HarnessConfig, PermissionEntry } from "../../src/schema.js";

const CLI_JSON = ".cursor/cli.json";
const HOOKS_JSON = ".cursor/hooks.json";
const RUNNER_REL = ".cursor/hooks/harnessport-format.mjs";
const RECORDED = "recorded.txt";
// Stands in for the formatter binary: records its last argument.
const FAKE_FORMATTER = '#!/bin/sh\nfor a; do :; done\nprintf %s "$a" > recorded.txt\n';

interface CpfWorld {
  config: HarnessConfig;
  items: FidelityItem[];
  outDir: string;
  before: Record<string, string>;
  lastItem?: FidelityItem;
  glob: string;
  command: string;
  imported: HarnessConfig;
}

const tmpDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "harnessport-cpf-"));
const emptyConfig = (): HarnessConfig => ({
  rules: [], agents: [], skills: [], commands: [], mcpServers: [], permissions: [], hooks: [],
  formatters: [], items: [],
});
const read = (w: CpfWorld, rel: string): string => fs.readFileSync(path.join(w.outDir, rel), "utf-8");
const readJson = (w: CpfWorld, rel: string) => JSON.parse(read(w, rel)) as Record<string, any>;
const exists = (w: CpfWorld, rel: string): boolean => fs.existsSync(path.join(w.outDir, rel));

function exportInto(w: CpfWorld, config: HarnessConfig): void {
  w.config = config;
  w.items = cursorConverter.export(w.outDir, config).items;
}

function seed(w: CpfWorld, rel: string, content: string): void {
  w.outDir ??= tmpDir();
  fs.mkdirSync(path.dirname(path.join(w.outDir, rel)), { recursive: true });
  fs.writeFileSync(path.join(w.outDir, rel), content);
  w.before = { ...w.before, [rel]: content };
}

function itemFor(w: CpfWorld, name: string): FidelityItem {
  const item = w.items.find((i) => i.name === name || i.name.endsWith(`/${name}`));
  assert.ok(item, JSON.stringify(w.items));
  w.lastItem = item;
  return item;
}

// --- Givens ---

Given(
  /^a canonical permission with tool `(\w+)`, pattern `([^`]+)`, action `(\w+)`$/,
  function (this: CpfWorld, tool: string, pattern: string, action: string) {
    this.config = { ...emptyConfig(), permissions: [{ tool, pattern, action: action as PermissionEntry["action"] }] };
  },
);

Given(
  /^a canonical formatter with glob `([^`]+)` and command `([^`]+)`$/,
  function (this: CpfWorld, glob: string, command: string) {
    this.config = { ...emptyConfig(), formatters: [{ glob, command }] };
  },
);

Given(
  /^the runner written for glob `([^`]+)` and command `([^`]+)`$/,
  function (this: CpfWorld, glob: string, command: string) {
    this.outDir = tmpDir();
    this.glob = glob;
    this.command = command;
    exportInto(this, { ...emptyConfig(), formatters: [{ glob, command }] });
    const bin = path.join(this.outDir, "bin");
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, command.split(/\s+/)[0]), FAKE_FORMATTER, { mode: 0o755 });
  },
);

Given(
  /^`\.cursor\/hooks\.json` written by the Cursor exporter for glob `([^`]+)` and command `([^`]+)`$/,
  function (this: CpfWorld, glob: string, command: string) {
    this.outDir = tmpDir();
    exportInto(this, { ...emptyConfig(), formatters: [{ glob, command }] });
  },
);

Given(
  /^`\.cursor\/hooks\.json` with an `afterFileEdit` entry whose command is `([^`]+)`$/,
  function (this: CpfWorld, command: string) {
    seed(this, HOOKS_JSON, JSON.stringify({ version: 1, hooks: { afterFileEdit: [{ command }] } }));
  },
);

Given(
  /^a canonical config with one PreToolUse guardrail and one shell-free formatter$/,
  function (this: CpfWorld) {
    this.config = {
      ...emptyConfig(),
      hooks: [{ event: "PreToolUse", matcher: "Bash", command: "./guard.sh" }],
      formatters: [{ glob: "*.py", command: "ruff format" }],
    };
  },
);

Given(
  /^an existing `\.cursor\/cli\.json` with content `(.+)`$/,
  function (this: CpfWorld, content: string) {
    seed(this, CLI_JSON, content);
  },
);

Given(
  /^an existing `\.cursor\/hooks\.json` with content `(.+)`$/,
  function (this: CpfWorld, content: string) {
    seed(this, HOOKS_JSON, content);
  },
);

Given(
  /^`\.cursor\/cli\.json` with `permissions\.allow` holding `([^`]+)`$/,
  function (this: CpfWorld, rule: string) {
    seed(this, CLI_JSON, JSON.stringify({ permissions: { allow: [rule], deny: [] } }));
  },
);

// --- Whens ---

When(/^the Cursor exporter exports the config into an empty project$/, function (this: CpfWorld) {
  this.outDir = tmpDir();
  exportInto(this, this.config);
});

When(
  /^the Cursor exporter exports a config with one Bash deny `([^`]+)`, without `--force`$/,
  function (this: CpfWorld, pattern: string) {
    exportInto(this, { ...emptyConfig(), permissions: [{ tool: "Bash", pattern, action: "deny" }] });
  },
);

When(
  /^the Cursor exporter exports a config with one shell-free formatter `([^`]+)` `([^`]+)`, without `--force`$/,
  function (this: CpfWorld, glob: string, command: string) {
    exportInto(this, { ...emptyConfig(), formatters: [{ glob, command }] });
  },
);

When(
  /^the Cursor exporter exports a config with one PreToolUse guardrail \(Bash, command `([^`]+)`\), without `--force`$/,
  function (this: CpfWorld, command: string) {
    exportInto(this, { ...emptyConfig(), hooks: [{ event: "PreToolUse", matcher: "Bash", command }] });
  },
);

When(/^the Cursor importer imports the project$/, function (this: CpfWorld) {
  this.imported = cursorConverter.import(this.outDir);
});

When(
  /^Cursor sends an `afterFileEdit` payload whose `file_path` is `([^`]+)`$/,
  function (this: CpfWorld, file: string) {
    spawnSync("node", [RUNNER_REL, this.glob, ...this.command.split(/\s+/)], {
      cwd: this.outDir,
      input: JSON.stringify({ file_path: file, edits: [] }),
      env: { ...process.env, PATH: `${path.join(this.outDir, "bin")}${path.delimiter}${process.env.PATH}` },
    });
  },
);

// --- Thens ---

Then(/^the item for `([^`]+)` has status `(\w+)`$/, function (this: CpfWorld, name: string, status: string) {
  assert.equal(itemFor(this, name).status, status, JSON.stringify(this.items));
});

Then(
  /^the item for `([^`]+)` has status `(\w+)`, not `\w+`$/,
  function (this: CpfWorld, name: string, status: string) {
    assert.equal(itemFor(this, name).status, status, JSON.stringify(this.items));
  },
);

Then(
  /^the item for the guardrail \(kind `(\w+)`, name `(\w+)`\) has status `(\w+)`$/,
  function (this: CpfWorld, kind: string, name: string, status: string) {
    const item = this.items.find((i) => i.kind === kind && i.name === name);
    assert.equal(item?.status, status, JSON.stringify(this.items));
  },
);

Then(/^its reason names Third-Party Imports$/, function (this: CpfWorld) {
  assert.ok(this.lastItem?.reason?.includes("Third-Party Imports"), this.lastItem?.reason);
});

Then(/^`\.cursor\/cli\.json` is not written(?: for it)?$/, function (this: CpfWorld) {
  assert.ok(!exists(this, CLI_JSON));
});

Then(
  /^`\.cursor\/cli\.json` holds `([^`]+)` in `permissions\.(allow|deny)`$/,
  function (this: CpfWorld, rule: string, list: string) {
    assert.ok(readJson(this, CLI_JSON).permissions[list].includes(rule), read(this, CLI_JSON));
  },
);

Then(/^its reason says the deny covers every command with the same first token$/, function (this: CpfWorld) {
  assert.ok(this.lastItem?.reason?.includes("every command with the same first token"), this.lastItem?.reason);
});

Then(
  /^the item's reason states that the `ask` rule is refused rather than written as an allow$/,
  function (this: CpfWorld) {
    assert.ok(this.lastItem?.reason?.includes('refusing to emit this "ask" rule as an allow'), this.lastItem?.reason);
  },
);

Then(
  /^`\.cursor\/hooks\.json` holds an `afterFileEdit` entry whose command runs `(.+)`$/,
  function (this: CpfWorld, command: string) {
    const entries = readJson(this, HOOKS_JSON).hooks.afterFileEdit as Array<{ command: string }>;
    assert.ok(entries.some((e) => e.command === `node ${command}`), read(this, HOOKS_JSON));
  },
);

Then(/^`\.cursor\/hooks\/harnessport-format\.mjs` exists$/, function (this: CpfWorld) {
  assert.ok(exists(this, RUNNER_REL));
});

Then(/^no `afterFileEdit` entry is written for it$/, function (this: CpfWorld) {
  assert.ok(!exists(this, HOOKS_JSON) || readJson(this, HOOKS_JSON).hooks.afterFileEdit === undefined);
});

Then(
  /^the formatter command runs on `([^`]+)` when `(yes|no)` is `yes`, and does not run when `(?:yes|no)` is `no`$/,
  function (this: CpfWorld, file: string, runs: string) {
    assert.equal(exists(this, RECORDED), runs === "yes");
    if (runs === "yes") assert.equal(read(this, RECORDED), file);
  },
);

Then(
  /^`\.cursor\/hooks\.json` holds a `preToolUse` array and an `afterFileEdit` array$/,
  function (this: CpfWorld) {
    const { hooks } = readJson(this, HOOKS_JSON);
    assert.ok(Array.isArray(hooks.preToolUse) && Array.isArray(hooks.afterFileEdit), read(this, HOOKS_JSON));
  },
);

Then(/^the PreToolUse guardrail's wrapper is still written as before$/, function (this: CpfWorld) {
  const wrapper = ".cursor/hooks/harnessport-guard-1.mjs";
  assert.ok(exists(this, wrapper));
  assert.equal(readJson(this, HOOKS_JSON).hooks.preToolUse[0].command, `node ${wrapper}`);
});

Then(/^`(\.cursor\/[\w.]+)` keeps its content$/, function (this: CpfWorld, rel: string) {
  assert.equal(read(this, rel), this.before[rel]);
});

Then(
  /^the canonical formatters hold glob `([^`]+)` and command `([^`]+)`$/,
  function (this: CpfWorld, glob: string, command: string) {
    assert.deepEqual(this.imported.formatters, [{ glob, command }]);
  },
);

Then(/^the canonical formatters are empty$/, function (this: CpfWorld) {
  assert.deepEqual(this.imported.formatters, []);
});

Then(/^the import items hold a dropped hook item for `afterFileEdit`$/, function (this: CpfWorld) {
  assert.ok(
    this.imported.items.some((i) => i.phase === "import" && i.kind === "hook" && i.name === "afterFileEdit" && i.status === "dropped"),
    JSON.stringify(this.imported.items),
  );
});

Then(/^the canonical permissions are empty$/, function (this: CpfWorld) {
  assert.deepEqual(this.imported.permissions, []);
});

When(
  /^the Cursor exporter exports the config with the target equal to the home directory$/,
  function (this: CpfWorld) {
    this.outDir = tmpDir();
    this.items = cursorConverter.export(this.outDir, this.config, { homeDir: this.outDir } as Parameters<typeof cursorConverter.export>[2]).items;
  },
);

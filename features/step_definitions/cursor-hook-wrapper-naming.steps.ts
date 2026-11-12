import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Then, When } from "@cucumber/cucumber";
import { cursorConverter } from "../../src/converters/cursor.js";
import type { HarnessConfig, Hook } from "../../src/schema.js";

interface NamingWorld {
  root: string;
  names: string[];
  expected?: string;
  obsolete?: string;
}

const config = (hooks: Hook[]): HarnessConfig => ({
  rules: [], agents: [], skills: [], commands: [], mcpServers: [], permissions: [],
  hooks, formatters: [], items: [],
});
const wrappers = (root: string): string[] =>
  fs.readdirSync(path.join(root, ".cursor", "hooks")).sort();
const exportHooks = (world: NamingWorld, hooks: Hook[], force = false): void => {
  world.root ??= fs.mkdtempSync(path.join(os.tmpdir(), "harnessport-naming-bdd-"));
  cursorConverter.export(world.root, config(hooks), { force });
  world.names = wrappers(world.root);
};

When(/^a hook command is `bash "\$HOME\/\.claude\/hooks\/python-guard\.sh"`$/, function (this: NamingWorld) {
  exportHooks(this, [{ event: "PreToolUse", matcher: "Bash", command: 'bash "$HOME/.claude/hooks/python-guard.sh"' }]);
  this.expected = ".cursor/hooks/harnessport-python-guard.mjs";
});

When(/^a hook command is `\.\/read-size-guard\.sh`$/, function (this: NamingWorld) {
  exportHooks(this, [{ event: "PreToolUse", matcher: "Bash", command: "./read-size-guard.sh" }]);
  this.expected = ".cursor/hooks/harnessport-read-size-guard.mjs";
});

Then(/^the generated wrapper is `(.+)`$/, function (this: NamingWorld, expected: string) {
  assert.ok(fs.existsSync(path.join(this.root, expected)));
});

Then("the corresponding Cursor hook entry references that file", function (this: NamingWorld) {
  const hooks = JSON.parse(fs.readFileSync(path.join(this.root, ".cursor", "hooks.json"), "utf-8"));
  assert.equal(hooks.hooks.beforeShellExecution[0].command, `node ${this.expected}`);
});

When("one source hook requires three generated wrappers", function (this: NamingWorld) {
  exportHooks(this, [{ event: "PreToolUse", matcher: "Bash|Read", command: "./shared-guard.sh" }]);
});

Then("their names use the source basename with no suffix, `-2`, and `-3`", function (this: NamingWorld) {
  assert.deepEqual(this.names, [
    "harnessport-shared-guard-2.mjs",
    "harnessport-shared-guard-3.mjs",
    "harnessport-shared-guard.mjs",
  ]);
});

When("separate source hook commands have the same filename stem", function (this: NamingWorld) {
  exportHooks(this, [
    { event: "PreToolUse", matcher: "Bash", command: "./one/shared.sh" },
    { event: "PreToolUse", matcher: "Bash", command: "./two/shared.sh" },
  ]);
});

Then("every generated wrapper has a distinct deterministic name", function (this: NamingWorld) {
  assert.deepEqual(this.names, ["harnessport-shared-2.mjs", "harnessport-shared.mjs"]);
});

When("a hook command has no path or script filename", function (this: NamingWorld) {
  exportHooks(this, [{ event: "PreToolUse", matcher: "Bash", command: "echo ready" }]);
});

Then("its wrapper receives the next available `harnessport-guard-<n>.mjs` name", function (this: NamingWorld) {
  assert.deepEqual(this.names, ["harnessport-guard-1.mjs"]);
});

When("a forced conversion no longer references a previously generated source-named wrapper", function (this: NamingWorld) {
  exportHooks(this, [{ event: "PreToolUse", matcher: "Bash", command: "./old-guard.sh" }]);
  this.obsolete = path.join(this.root, ".cursor", "hooks", "harnessport-old-guard.mjs");
  fs.writeFileSync(path.join(this.root, ".cursor", "hooks", "foreign.mjs"), "foreign");
  exportHooks(this, [{ event: "PreToolUse", matcher: "Bash", command: "./new-guard.sh" }], true);
});

Then("that obsolete wrapper is removed", function (this: NamingWorld) {
  assert.equal(fs.existsSync(this.obsolete!), false);
});

Then(/^unrelated files in `\.cursor\/hooks` remain$/, function (this: NamingWorld) {
  assert.equal(fs.readFileSync(path.join(this.root, ".cursor", "hooks", "foreign.mjs"), "utf-8"), "foreign");
});

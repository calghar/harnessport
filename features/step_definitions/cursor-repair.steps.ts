import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Given, Then, When } from "@cucumber/cucumber";
import { roundTripLoss, type RoundTripLoss } from "../../src/compare.js";
import { cursorConverter } from "../../src/converters/cursor.js";
import type { FidelityItem, HarnessConfig, PermissionEntry } from "../../src/schema.js";

interface RepairWorld {
  root: string;
  config: HarnessConfig;
  imported: HarnessConfig;
  items: FidelityItem[];
  loss: RoundTripLoss;
  source: HarnessConfig;
  target: HarnessConfig;
  token?: string;
  wrapperOutput?: Record<string, unknown>;
}

const emptyConfig = (): HarnessConfig => ({
  rules: [], agents: [], skills: [], commands: [], mcpServers: [],
  permissions: [], hooks: [], formatters: [], items: [],
});
const tmpDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "harnessport-repair-bdd-"));
const put = (root: string, relative: string, content: string): void => {
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
  fs.writeFileSync(path.join(root, relative), content);
};
const parsePermission = (source: string, action: PermissionEntry["action"]): PermissionEntry => {
  const match = /^(.+)\((.*)\)$/.exec(source);
  assert.ok(match);
  return { tool: match[1], pattern: match[2], action };
};

Given("a Cursor user config with model settings and a Cursor-only allow rule", function (this: RepairWorld) {
  this.root = tmpDir();
  put(this.root, ".cursor/cli-config.json", JSON.stringify({
    version: 1,
    model: { name: "custom" },
    permissions: { allow: ["Shell(cursor-only)"], deny: [] },
  }));
  this.config = {
    ...emptyConfig(),
    permissions: [
      { tool: "Read", pattern: "./.env", action: "deny" },
      { tool: "Bash", pattern: "claude *", action: "allow" },
    ],
  };
});

When("Claude permissions are exported to the home directory with force", function (this: RepairWorld) {
  this.items = cursorConverter.export(this.root, this.config, {
    force: true,
    homeDir: this.root,
  }).items;
});

Then("model settings remain and permission arrays contain only mapped Claude rules", function (this: RepairWorld) {
  const json = JSON.parse(fs.readFileSync(path.join(this.root, ".cursor/cli-config.json"), "utf-8"));
  assert.deepEqual(json.model, { name: "custom" });
  assert.deepEqual(json.permissions, {
    allow: ["Shell(claude:*)"],
    deny: ["Read(./.env)"],
  });
});

Given("a Cursor permission file holding allow and deny tokens", function (this: RepairWorld) {
  this.root = tmpDir();
  put(this.root, ".cursor/cli.json", JSON.stringify({
    permissions: {
      allow: ["Shell(claude:*)", "Mcp(jira:get)"],
      deny: ["Read(.env*)"],
    },
  }));
});

When("the Cursor converter imports it", function (this: RepairWorld) {
  this.imported = cursorConverter.import(this.root);
});

Then("canonical permissions carry each action tool and pattern", function (this: RepairWorld) {
  assert.deepEqual(this.imported.permissions, [
    { tool: "Bash", pattern: "claude *", action: "allow" },
    { tool: "mcp__jira__get", pattern: "*", action: "allow" },
    { tool: "Read", pattern: ".env*", action: "deny" },
  ]);
});

When(
  /^a Claude `(\w+)` permission `(.+)` is exported to Cursor$/,
  function (this: RepairWorld, action: PermissionEntry["action"], source: string) {
    this.root = tmpDir();
    this.config = { ...emptyConfig(), permissions: [parsePermission(source, action)] };
    this.items = cursorConverter.export(this.root, this.config).items;
    const file = path.join(this.root, ".cursor/cli.json");
    if (fs.existsSync(file)) {
      const permissions = JSON.parse(fs.readFileSync(file, "utf-8")).permissions;
      this.token = [...permissions.allow, ...permissions.deny][0];
    }
  },
);

Then(
  /^the target token is `(.+)` with fidelity `(\w+)`$/,
  function (this: RepairWorld, target: string, status: FidelityItem["status"]) {
    assert.equal(this.token, target === "(absent)" ? undefined : target);
    assert.equal(this.items.find((item) => item.kind === "permission")?.status, status);
  },
);

Given("a Claude ask permission for mcp__jira__jira_post", function (this: RepairWorld) {
  this.root = tmpDir();
  this.config = {
    ...emptyConfig(),
    permissions: [{ tool: "mcp__jira__jira_post", pattern: "*", action: "ask" }],
  };
  cursorConverter.export(this.root, this.config);
});

function runMcpWrapper(world: RepairWorld, tool: string): void {
  const json = JSON.parse(fs.readFileSync(path.join(world.root, ".cursor/hooks.json"), "utf-8"));
  const command = json.hooks.beforeMCPExecution[0].command as string;
  const wrapper = command.replace(/^node\s+"?/, "").replace(/"$/, "");
  const result = spawnSync("node", [path.join(world.root, wrapper)], {
    input: JSON.stringify({ mcp_server_name: "jira", tool_name: tool, tool_input: "{}" }),
    encoding: "utf-8",
  });
  world.wrapperOutput = JSON.parse(result.stdout);
}

When("Cursor sends beforeMCPExecution for jira jira_post", function (this: RepairWorld) {
  runMcpWrapper(this, "jira_post");
});

When("Cursor sends beforeMCPExecution for another tool", function (this: RepairWorld) {
  runMcpWrapper(this, "jira_get");
});

Then("the MCP wrapper asks", function (this: RepairWorld) {
  assert.equal(this.wrapperOutput?.permission, "ask");
});

Then("the MCP wrapper allows", function (this: RepairWorld) {
  assert.equal(this.wrapperOutput?.permission, "allow");
});

Given("Cursor hooks generated from one Claude Read guard", function (this: RepairWorld) {
  this.root = tmpDir();
  cursorConverter.export(this.root, {
    ...emptyConfig(),
    hooks: [{ event: "PreToolUse", matcher: "Read", command: "./guard.sh" }],
  });
});

When("the Cursor converter imports them", function (this: RepairWorld) {
  this.imported = cursorConverter.import(this.root);
});

Then("one canonical PreToolUse Read hook is returned", function (this: RepairWorld) {
  assert.equal(this.imported.hooks.length, 1);
  assert.deepEqual(this.imported.hooks[0], {
    event: "PreToolUse",
    matcher: "Read",
    command: "./guard.sh",
    args: [],
    timeout: undefined,
    failClosed: undefined,
  });
});

Given("a foreign Cursor preToolUse hook", function (this: RepairWorld) {
  this.root = tmpDir();
  put(this.root, ".cursor/hooks.json", JSON.stringify({
    version: 1,
    hooks: { preToolUse: [{ command: "node foreign.mjs" }] },
  }));
});

Then("the foreign hook is reported dropped", function (this: RepairWorld) {
  assert.ok(this.imported.items.some(
    (item) => item.kind === "hook" && item.status === "dropped",
  ));
});

Given(/^a directory containing only `(.+)`$/, function (this: RepairWorld, file: string) {
  this.root = tmpDir();
  put(this.root, file, "{}");
});

When("harnessport detects Cursor", function (this: RepairWorld) {
  this.token = String(cursorConverter.detect(this.root));
});

Then("Cursor is detected", function (this: RepairWorld) {
  assert.equal(this.token, "true");
});

Given("a previous conversion wrote an extra generated wrapper", function (this: RepairWorld) {
  this.root = tmpDir();
  put(this.root, ".cursor/hooks/harnessport-guard-2.mjs", "stale");
  put(this.root, ".cursor/hooks/foreign.mjs", "foreign");
  this.config = {
    ...emptyConfig(),
    hooks: [{ event: "PreToolUse", matcher: "Bash", command: "./guard.sh" }],
  };
});

When("the current conversion runs with force", function (this: RepairWorld) {
  cursorConverter.export(this.root, this.config, { force: true });
});

Then("only the stale generated wrapper is removed", function (this: RepairWorld) {
  assert.equal(fs.existsSync(path.join(this.root, ".cursor/hooks/harnessport-guard-2.mjs")), false);
  assert.equal(fs.existsSync(path.join(this.root, ".cursor/hooks/foreign.mjs")), true);
});

Given("a Claude agent with skills and tools", function (this: RepairWorld) {
  this.config = {
    ...emptyConfig(),
    agents: [{ name: "agent", body: "body", skills: ["skill"], tools: ["Read"] }],
  };
});

Given("a Claude command with a description and allowed tools", function (this: RepairWorld) {
  this.config = {
    ...emptyConfig(),
    commands: [{ name: "command", body: "body", description: "d", allowedTools: ["Read"] }],
  };
});

Given("an MCP server with an enabled state", function (this: RepairWorld) {
  this.config = {
    ...emptyConfig(),
    mcpServers: [{ name: "server", type: "stdio", command: "server", enabled: false }],
  };
});

Given("a Claude SubagentStart hook", function (this: RepairWorld) {
  this.config = {
    ...emptyConfig(),
    hooks: [{ event: "SubagentStart", command: "./guard.sh" }],
  };
});

When("that config is exported to Cursor", function (this: RepairWorld) {
  this.root = tmpDir();
  this.items = cursorConverter.export(this.root, this.config).items;
});

Then("the agent fidelity is lossy and names skills and tools", function (this: RepairWorld) {
  const item = this.items.find((candidate) => candidate.kind === "agent");
  assert.equal(item?.status, "lossy");
  assert.match(item?.reason ?? "", /skills.*tools/);
});

Then("the command fidelity is lossy and names description and allowed tools", function (this: RepairWorld) {
  const item = this.items.find((candidate) => candidate.kind === "command");
  assert.equal(item?.status, "lossy");
  assert.match(item?.reason ?? "", /description.*allowedTools/);
});

Then("the MCP fidelity is lossy and names enabled", function (this: RepairWorld) {
  const item = this.items.find((candidate) => candidate.kind === "mcp");
  assert.equal(item?.status, "lossy");
  assert.match(item?.reason ?? "", /enabled/);
});

Then("the hook fidelity is lossy and names the missing CLI event", function (this: RepairWorld) {
  const item = this.items.find((candidate) => candidate.kind === "hook");
  assert.equal(item?.status, "lossy");
  assert.match(item?.reason ?? "", /did not emit `subagentStart`/);
});

Given("round-trip configs whose permission action changed", function (this: RepairWorld) {
  this.source = {
    ...emptyConfig(),
    permissions: [{ tool: "Read", pattern: ".env", action: "deny" }],
  };
  this.target = {
    ...emptyConfig(),
    permissions: [{ tool: "Read", pattern: ".env", action: "allow" }],
  };
});

Given("round-trip configs whose agent tools were dropped", function (this: RepairWorld) {
  this.source = {
    ...emptyConfig(),
    agents: [{ name: "agent", body: "body", tools: ["Read"] }],
  };
  this.target = {
    ...emptyConfig(),
    agents: [{ name: "agent", body: "body" }],
  };
  this.items = [];
});

When("round-trip loss is calculated", function (this: RepairWorld) {
  this.loss = roundTripLoss(this.source, this.target, this.items ?? []);
});

Then("the permission is unaccounted loss", function (this: RepairWorld) {
  assert.deepEqual(this.loss.unaccounted, [{ kind: "permission", name: "Read(.env)" }]);
});

Then("the agent is unaccounted unless fidelity is lossy", function (this: RepairWorld) {
  assert.deepEqual(this.loss.unaccounted, [{ kind: "agent", name: "agent" }]);
});

Given("differing generated Cursor files", function (this: RepairWorld) {
  this.root = tmpDir();
  put(this.root, ".cursor/cli.json", "{}");
  this.config = {
    ...emptyConfig(),
    permissions: [{ tool: "Read", pattern: ".env", action: "deny" }],
  };
});

When("a forced dry run is exported", function (this: RepairWorld) {
  this.items = cursorConverter.export(this.root, this.config, {
    force: true,
    dryRun: true,
  }).items;
});

Then("no fidelity item names a bak path", function (this: RepairWorld) {
  assert.equal(this.items.some((item) => item.name.endsWith(".bak")), false);
});

import assert from "node:assert/strict";
import { Given, Then } from "@cucumber/cucumber";
import type { FidelityItem, HarnessConfig } from "../../src/schema.js";

interface CodexWorld {
  config: HarnessConfig;
  items: FidelityItem[];
}

const withHook = (hook: HarnessConfig["hooks"][number]): HarnessConfig => ({
  rules: [], agents: [], skills: [], commands: [],
  mcpServers: [], permissions: [], hooks: [hook], formatters: [], items: [],
});

Given(
  /^a canonical config holding a hook `\{event: "(\w+)", matcher: "(\w+(?:\|\w+)+)", command: "([^"]+)"\}`$/,
  function (this: CodexWorld, event: string, matcher: string, command: string) {
    this.config = withHook({ event, matcher, command });
  },
);

Given(
  /^a canonical config holding a hook `\{event: "(\w+)", matcher: "(\w+)", command: "([^"]+)", failClosed: true\}`$/,
  function (this: CodexWorld, event: string, matcher: string, command: string) {
    this.config = withHook({ event, matcher, command, failClosed: true });
  },
);

Then(/^its reason names `(\w+)`$/, function (this: CodexWorld, token: string) {
  const item = this.items.find((i) => i.kind === "hook");
  assert.ok(item?.reason?.includes(token), JSON.stringify(this.items));
});

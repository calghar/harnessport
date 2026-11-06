import assert from "node:assert/strict";
import { AfterStep, Given, Then } from "@cucumber/cucumber";
import type { FidelityItem, HarnessConfig } from "../../src/schema.js";

interface OpencodeWorld {
  config: HarnessConfig;
  items?: FidelityItem[];
  status?: number | null;
}

Given(
  /^a canonical config holding only a hook `\{event: "(\w+)", matcher: "(\w+)", command: "([^"]+)"\}`$/,
  function (this: OpencodeWorld, event: string, matcher: string, command: string) {
    this.config = {
      rules: [], agents: [], skills: [], commands: [],
      mcpServers: [], permissions: [], hooks: [{ event, matcher, command }], formatters: [], items: [],
    };
  },
);

Then(/^its reason names `(\w+(?:\.\w+)+)`$/, function (this: OpencodeWorld, token: string) {
  const item = this.items?.find((i) => i.kind === "hook");
  assert.ok(item?.reason?.includes(token), JSON.stringify(this.items));
});

// In-process exports have no CLI; derive the exit code the way src/index.ts does (blocked => 2).
AfterStep(function (this: OpencodeWorld) {
  if (this.items && this.status === undefined) {
    this.status = this.items.some((i) => i.status === "blocked") ? 2 : 0;
  }
});

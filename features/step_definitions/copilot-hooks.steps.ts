import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AfterStep, Given, Then, When } from "@cucumber/cucumber";
import { copilotConverter } from "../../src/converters/copilot.js";
import type { FidelityItem, HarnessConfig } from "../../src/schema.js";

interface CopilotWorld {
  config: HarnessConfig;
  items: FidelityItem[];
  outDir: string;
  existingContent?: string;
  status?: number | null;
}

type Json = Record<string, unknown>;

// Feature text writes JS-object literals with bare keys; quote them so JSON.parse reads them.
const parseLiteral = (text: string): Json =>
  JSON.parse(text.replace(/([{,]\s*)(\w+):/g, '$1"$2":')) as Json;

const emptyConfig = (): HarnessConfig => ({
  rules: [], agents: [], skills: [], commands: [],
  mcpServers: [], permissions: [], hooks: [], formatters: [], items: [],
});

const emittedHooks = (w: CopilotWorld): Json => {
  const file = JSON.parse(fs.readFileSync(path.join(w.outDir, ".github/hooks/hooks.json"), "utf-8")) as Json;
  return file.hooks as Json;
};

const entryAt = (w: CopilotWorld, event: string): Json =>
  (emittedHooks(w)[event] as Json[])[0];

const hookItem = (w: CopilotWorld): FidelityItem => {
  const item = w.items.find((i) => i.kind === "hook");
  assert.ok(item, JSON.stringify(w.items));
  return item;
};

const hookFile = (w: CopilotWorld, fileName: string): Json =>
  JSON.parse(fs.readFileSync(path.join(w.outDir, ".github/hooks", fileName), "utf-8")) as Json;

const roundTripFiles = (
  w: CopilotWorld,
  files: Record<string, Json>,
): void => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "harnessport-bdd-"));
  for (const [fileName, body] of Object.entries(files)) {
    const filePath = path.join(source, ".github/hooks", fileName);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(body));
  }
  w.config = copilotConverter.import(source);
  w.outDir = fs.mkdtempSync(path.join(os.tmpdir(), "harnessport-bdd-"));
  w.items = copilotConverter.export(w.outDir, w.config).items;
}

// The CLI exits 2 when any item is blocked; the shared export step does not record an exit code.
AfterStep(function (this: CopilotWorld) {
  if (this.items && this.status === undefined) {
    this.status = this.items.some((i) => i.status === "blocked") ? 2 : 0;
  }
});

Given(
  /^a canonical config holding a hook `\{(event: "\w+", (?:command: "[^"]+"|matcher: "\w+", command: "[^"]+", (?:timeout|args): [^`]+))\}`$/,
  function (this: CopilotWorld, literal: string) {
    this.config = { ...emptyConfig(), hooks: [parseLiteral(`{${literal}}`) as unknown as HarnessConfig["hooks"][number]] };
  },
);

Given(
  /^`\.github\/hooks\/hooks\.json` holding `(.+)`(?: with no `version` key)?$/,
  function (this: CopilotWorld, literal: string) {
    this.outDir = fs.mkdtempSync(path.join(os.tmpdir(), "harnessport-bdd-"));
    const dir = path.join(this.outDir, ".github/hooks");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "hooks.json"), JSON.stringify(parseLiteral(literal)));
    this.config = copilotConverter.import(this.outDir);
  },
);

Then(
  /^the imported hook has event `(\w+)` and dialect `(\w+)`$/,
  function (this: CopilotWorld, event: string, dialect: string) {
    assert.equal(this.config.hooks[0].event, event);
    assert.equal(this.config.hooks[0].dialect, dialect);
  },
);

Then(/^the imported hook has no dialect$/, function (this: CopilotWorld) {
  assert.equal(this.config.hooks[0].dialect, undefined);
});

Then(
  /^the export item of kind `hook` named `(\w+)` has status `(\w+)`$/,
  function (this: CopilotWorld, name: string, status: string) {
    const item = this.items.find((i) => i.kind === "hook" && i.name === name);
    assert.equal(item?.status, status, JSON.stringify(this.items));
  },
);

Then(
  /^`\.claude\/settings\.json` holds no entry for `([^`]+)`$/,
  function (this: CopilotWorld, command: string) {
    const file = path.join(this.outDir, ".claude/settings.json");
    const text = fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : "";
    assert.ok(!text.includes(command), text);
  },
);

Then(
  /^`\.claude\/settings\.json` holds `hooks\.PreToolUse\[0\]\.hooks\[0\]\.command` equal to `([^`]+)`$/,
  function (this: CopilotWorld, command: string) {
    const json = JSON.parse(fs.readFileSync(path.join(this.outDir, ".claude/settings.json"), "utf-8")) as {
      hooks: { PreToolUse: Array<{ hooks: Array<{ command: string }> }> };
    };
    assert.equal(json.hooks.PreToolUse[0].hooks[0].command, command);
  },
);

Then(
  /^the emitted `\.github\/hooks\/hooks\.json` has key `hooks\.(\w+)` holding `bash: "([^"]+)"`$/,
  function (this: CopilotWorld, event: string, bash: string) {
    assert.equal(entryAt(this, event).bash, bash);
  },
);

Then(
  /^`\.github\/hooks\/hooks\.json` parses to an object with `version: 1` and a `hooks` object$/,
  function (this: CopilotWorld) {
    const file = JSON.parse(fs.readFileSync(path.join(this.outDir, ".github/hooks/hooks.json"), "utf-8")) as Json;
    assert.equal(file.version, 1);
    assert.equal(typeof file.hooks, "object");
  },
);

Then(
  /^`hooks\.(\w+)\[0\]` equals `(\{.+\})`$/,
  function (this: CopilotWorld, event: string, literal: string) {
    assert.deepEqual(entryAt(this, event), parseLiteral(literal));
  },
);

Then(
  /^`hooks\.(\w+)\[0\]\.matcher` contains `(\w+)` and `(\w+)`$/,
  function (this: CopilotWorld, event: string, a: string, b: string) {
    const matcher = entryAt(this, event).matcher as string;
    assert.ok(matcher.includes(a) && matcher.includes(b), matcher);
  },
);

Then(
  /^`hooks\.(\w+)\[0\]\.matcher` in the emitted file equals `([^`]+)`$/,
  function (this: CopilotWorld, event: string, matcher: string) {
    assert.equal(entryAt(this, event).matcher, matcher);
  },
);

Then(/^its reason contains `(\w+)`$/, function (this: CopilotWorld, text: string) {
  assert.ok(hookItem(this).reason?.includes(text), JSON.stringify(this.items));
});

Then(
  /^its reason states that Copilot drops the output of config-file `userPromptSubmitted` hooks$/,
  function (this: CopilotWorld) {
    const text = "Copilot drops the output of config-file `userPromptSubmitted` hooks";
    assert.ok(hookItem(this).reason?.includes(text), JSON.stringify(this.items));
  },
);

When(
  "a Copilot source contains `policy.json` with a `preToolUse` entry and `audit.json` with a `postToolUse` entry",
  function (this: CopilotWorld) {
    roundTripFiles(this, {
      "policy.json": { version: 1, hooks: { preToolUse: [{ type: "command", bash: "./policy.sh" }] } },
      "audit.json": { version: 1, hooks: { postToolUse: [{ type: "command", bash: "./audit.sh" }] } },
    });
  },
);

Then(
  /^a Copilot export writes the `(\w+)` entry to `\.github\/hooks\/([^`]+)`$/,
  function (this: CopilotWorld, event: string, fileName: string) {
    assert.ok((hookFile(this, fileName).hooks as Json)[event]);
  },
);

Then(
  /^it writes the `(\w+)` entry to `\.github\/hooks\/([^`]+)`$/,
  function (this: CopilotWorld, event: string, fileName: string) {
    assert.ok((hookFile(this, fileName).hooks as Json)[event]);
  },
);

Then(/^it does not combine both entries in `\.github\/hooks\/hooks\.json`$/, function (this: CopilotWorld) {
  const filePath = path.join(this.outDir, ".github/hooks/hooks.json");
  assert.equal(fs.existsSync(filePath), false);
});

When(
  "a Copilot source file `lifecycle.json` contains entries for `sessionStart` and `sessionEnd`",
  function (this: CopilotWorld) {
    roundTripFiles(this, {
      "lifecycle.json": { version: 1, hooks: {
        sessionStart: [{ type: "command", bash: "./start.sh" }],
        sessionEnd: [{ type: "command", bash: "./end.sh" }],
      } },
    });
  },
);

Then(
  /^a Copilot export writes both entries to `\.github\/hooks\/lifecycle\.json`$/,
  function (this: CopilotWorld) {
    const hooks = hookFile(this, "lifecycle.json").hooks as Json;
    assert.ok(hooks.sessionStart);
    assert.ok(hooks.sessionEnd);
  },
);

When(
  "a Copilot source file `guard.json` uses the accepted bare event-table shape",
  function (this: CopilotWorld) {
    roundTripFiles(this, {
      "guard.json": { PreToolUse: [{ type: "command", bash: "./guard.sh" }] },
    });
  },
);

Then(
  /^a Copilot export writes the imported entries to `\.github\/hooks\/guard\.json`$/,
  function (this: CopilotWorld) {
    assert.ok((hookFile(this, "guard.json").hooks as Json).PreToolUse);
  },
);

Then("the exported file uses the documented `version: 1` wrapper", function (this: CopilotWorld) {
  assert.equal(hookFile(this, "guard.json").version, 1);
});

When(
  /^a Copilot source file `guard\.json` is exported to a target whose `\.github\/hooks\/guard\.json` has different content$/,
  function (this: CopilotWorld) {
    const source = fs.mkdtempSync(path.join(os.tmpdir(), "harnessport-bdd-"));
    const sourceFile = path.join(source, ".github/hooks/guard.json");
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.writeFileSync(sourceFile, JSON.stringify({ hooks: {
      preToolUse: [{ type: "command", bash: "./guard.sh" }],
    } }));
    this.outDir = fs.mkdtempSync(path.join(os.tmpdir(), "harnessport-bdd-"));
    const targetFile = path.join(this.outDir, ".github/hooks/guard.json");
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    this.existingContent = '{"foreign":true}\n';
    fs.writeFileSync(targetFile, this.existingContent);
    this.items = copilotConverter.export(this.outDir, copilotConverter.import(source)).items;
  },
);

Then("the existing target file remains unchanged", function (this: CopilotWorld) {
  assert.equal(
    fs.readFileSync(path.join(this.outDir, ".github/hooks/guard.json"), "utf-8"),
    this.existingContent,
  );
});

Then(
  "the refused write is reported under the existing target-file write policy",
  function (this: CopilotWorld) {
    assert.ok(this.items.some((item) => item.status === "blocked" && item.name.endsWith("guard.json")));
  },
);

When("a Claude hook is exported to Copilot", function (this: CopilotWorld) {
  this.outDir = fs.mkdtempSync(path.join(os.tmpdir(), "harnessport-bdd-"));
  this.items = copilotConverter.export(this.outDir, {
    ...emptyConfig(),
    hooks: [{ event: "PostToolUse", command: "./audit.sh" }],
  }).items;
});

Then(/^the hook is written to `\.github\/hooks\/hooks\.json`$/, function (this: CopilotWorld) {
  assert.ok((hookFile(this, "hooks.json").hooks as Json).PostToolUse);
});

When(
  "a Copilot export contains one hook retained from `policy.json` and one hook with no retained Copilot source filename",
  function (this: CopilotWorld) {
    this.outDir = fs.mkdtempSync(path.join(os.tmpdir(), "harnessport-bdd-"));
    this.items = copilotConverter.export(this.outDir, {
      ...emptyConfig(),
      hooks: [
        { event: "postToolUse", command: "./policy.sh", dialect: "copilot", sourceFile: "policy.json" },
        { event: "PostToolUse", command: "./default.sh" },
      ],
    }).items;
  },
);

Then(/^the retained hook is written to `\.github\/hooks\/policy\.json`$/, function (this: CopilotWorld) {
  assert.ok((hookFile(this, "policy.json").hooks as Json).postToolUse);
});

Then(/^the unnamed hook is written to `\.github\/hooks\/hooks\.json`$/, function (this: CopilotWorld) {
  assert.ok((hookFile(this, "hooks.json").hooks as Json).PostToolUse);
});

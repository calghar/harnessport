import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Given, Then, When } from "@cucumber/cucumber";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

interface TargetSetWorld {
  src?: string;
  out: string;
  target?: string;
  status: number | null;
  stdout: string;
  stderr: string;
}

const tmpDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "harnessport-bdd-"));

function writeFile(root: string, rel: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content);
}

Given(/^a source project holding `\.claude\/settings\.json`$/, function (this: TargetSetWorld) {
  this.src = tmpDir();
  writeFile(this.src, ".claude/settings.json", "{}");
});

Given(/^a directory holding `(\.windsurf\/[^`]+)`$/, function (this: TargetSetWorld, rel: string) {
  this.src = tmpDir();
  writeFile(this.src, rel, "# rule\n");
});

Given(
  /^a target directory holding `([^`]+)` with content `([^`]+)`$/,
  function (this: TargetSetWorld, rel: string, content: string) {
    this.target = tmpDir();
    writeFile(this.target, rel, content);
  },
);

When(/^running `([^`]+)`(?: into that directory)?$/, function (this: TargetSetWorld, cmd: string) {
  if (!this.src) {
    this.src = tmpDir();
    writeFile(this.src, ".claude/settings.json", "{}");
  }
  this.out = path.join(tmpDir(), "out");
  const args = cmd
    .replaceAll("<dir>", this.src)
    .replaceAll("<out>", this.out)
    .replaceAll("<target>", this.target ?? this.out)
    .split(/\s+/);
  const r = spawnSync("npx", ["tsx", "src/index.ts", ...args], { cwd: ROOT, encoding: "utf-8" });
  this.status = r.status;
  this.stdout = r.stdout;
  this.stderr = r.stderr;
});

Then(/^the process exits `(\d+)`$/, function (this: TargetSetWorld, code: string) {
  assert.equal(this.status, Number(code), this.stderr);
});

Then(
  /^stderr names `(\w+)` as an unknown (target|source)(?: and lists `([^`]+)`)?$/,
  function (this: TargetSetWorld, name: string, role: string, list?: string) {
    assert.ok(this.stderr.includes(`Unknown ${role}: "${name}"`), this.stderr);
    if (list) assert.ok(this.stderr.includes(`Available: ${list}`), this.stderr);
  },
);

Then(/^`<out>` is not created$/, function (this: TargetSetWorld) {
  assert.equal(fs.existsSync(this.out), false);
});

Then(/^stdout contains each of (.+)$/, function (this: TargetSetWorld, names: string) {
  for (const [, name] of names.matchAll(/`([^`]+)`/g)) {
    assert.ok(this.stdout.includes(name), `${name} missing from: ${this.stdout}`);
  }
});

Then(/^stdout does not contain `([^`]+)`$/, function (this: TargetSetWorld, text: string) {
  assert.ok(!this.stdout.toLowerCase().includes(text), this.stdout);
});

Then(/^`([^`]+)` still holds `([^`]+)`$/, function (this: TargetSetWorld, rel: string, content: string) {
  assert.equal(fs.readFileSync(path.join(this.target as string, rel), "utf-8"), content);
});

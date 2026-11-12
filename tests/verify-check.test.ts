import { describe, it, expect } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { CONVERTERS } from "../src/matrix.js";
import { roundTripLoss, } from "../src/compare.js";
import type { FidelityItem, HarnessConfig } from "../src/schema.js";

// Mirrors features/round-trip-verification.feature and features/config-drift-check.feature,

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, "fixtures");
const CLI = path.resolve(HERE, "..", "dist", "index.js");
const _hasBuild = fs.existsSync(CLI);

const FIXTURE_DIRS: Record<string, string> = {
  claude: "sample-project",
  opencode: "opencode-project",
  cursor: "cursor-project",
  copilot: "copilot-project",
  codex: "codex-project",
};

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "harnessport-vc-"));
}

function _run(args: string[]) {
  const r = spawnSync("node", [CLI, ...args], { encoding: "utf-8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** A hash of every file under a directory, so "unchanged" is checked rather than assumed. */
function _treeHash(dir: string): string {
  const hash = crypto.createHash("sha256");
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else hash.update(path.relative(dir, p)).update(fs.readFileSync(p));
    }
  };
  walk(dir);
  return hash.digest("hex");
}

/** Copy a fixture so a test that (wrongly) wrote into it could not corrupt the real one. */
function _copyFixture(name: string): string {
  const dir = tmpDir();
  fs.cpSync(path.join(FIXTURES, FIXTURE_DIRS[name]), dir, { recursive: true });
  return dir;
}

describe("Requirement: verify separates accounted-for loss from unaccounted loss", () => {
  function verify(from: string, to: string) {
    const source = CONVERTERS[from].import(path.join(FIXTURES, FIXTURE_DIRS[from]));
    const dir = tmpDir();
    const result = CONVERTERS[to].export(dir, source, {});
    return roundTripLoss(source, CONVERTERS[to].import(dir), result.items);
  }

  it("A dropped permission is accounted for", () => {
    const loss = verify("claude", "cursor");
    expect(loss.accounted.some((l) => l.kind === "permission")).toBe(true);
    expect(loss.unaccounted.filter((l) => l.kind === "permission")).toEqual([]);
  });

  it("Unaccounted loss is detected when the report claims exact", () => {
    const source: HarnessConfig = {
      rules: [], agents: [{ name: "ghost", body: "x" }], skills: [], commands: [],
      mcpServers: [], permissions: [], hooks: [], formatters: [], items: [],
    };
    const target: HarnessConfig = { ...source, agents: [] };
    // A report claiming the agent converted fully, while it is absent from the target.
    const items: FidelityItem[] = [
      { phase: "export", kind: "agent", name: "ghost", status: "exact" },
    ];
    const loss = roundTripLoss(source, target, items);
    expect(loss.unaccounted).toEqual([{ kind: "agent", name: "ghost" }]);
    expect(loss.accounted).toEqual([]);
  });

  it("Copilot source filenames are not runtime hook loss", () => {
    const source: HarnessConfig = {
      rules: [], agents: [], skills: [], commands: [], mcpServers: [], permissions: [],
      hooks: [{ event: "PostToolUse", command: "./audit.sh", sourceFile: "audit.json" }],
      formatters: [], items: [],
    };
    const target: HarnessConfig = {
      ...source,
      hooks: [{ event: "PostToolUse", command: "./audit.sh" }],
    };
    expect(roundTripLoss(source, target, []).unaccounted).toEqual([]);
  });
});


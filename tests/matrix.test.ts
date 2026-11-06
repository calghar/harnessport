import { describe, it, expect } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import { ALL_CONVERTERS, CONVERTERS } from "../src/matrix.js";
import { roundTripLoss } from "../src/compare.js";
import type { Converter } from "../src/converters/types.js";
import type { FidelityItem } from "../src/schema.js";

// Mirrors features/conversion-matrix.feature.
//
// The suite this replaces exercised one importer and five exporters, every one with dryRun:true —
// so five importers and the entire serialization path never ran, and a block named "round-trip"
// performed no export and no re-import.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, "fixtures");

/** The project fixture standing in for each harness as a conversion source. */
const FIXTURE_DIRS: Record<string, string> = {
  claude: "sample-project",
  opencode: "opencode-project",
  cursor: "cursor-project",
  copilot: "copilot-project",
  codex: "codex-project",
};

const NAMES = ALL_CONVERTERS.map((c) => c.name);

/** Every ordered pair of distinct harnesses — the 20 real conversion paths. */
const PAIRS: Array<[string, string]> = NAMES.flatMap((from) =>
  NAMES.filter((to) => to !== from).map((to): [string, string] => [from, to]),
);

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "harnessport-matrix-"));
}

function fixtureFor(name: string): string {
  return path.join(FIXTURES, FIXTURE_DIRS[name]);
}

/**
 * Import a fixture, export it to a real directory, and re-import with the target.
 * Dry runs never execute serialization, which is why every assertion here writes files.
 */
function convert(from: Converter, to: Converter) {
  const source = from.import(fixtureFor(from.name));
  const dir = tmpDir();
  const result = to.export(dir, source, {});
  return { source, dir, result, target: to.import(dir) };
}

function blockedNames(items: FidelityItem[]): string[] {
  return items.filter((i) => i.status === "blocked").map((i) => i.name).sort();
}

describe("Requirement: Every ordered pair of harnesses converts end to end", () => {
  it("detects, keeps rule text and skill names, is idempotent and explains every loss", () => {
    for (const name of NAMES) {
      expect(CONVERTERS[name].detect(fixtureFor(name)), name).toBe(true);
    }
    expect(PAIRS).toHaveLength(20);
    for (const [from, to] of PAIRS) {
      const label = `${from} -> ${to}`;
      const { source, dir, result, target } = convert(CONVERTERS[from], CONVERTERS[to]);
      expect(CONVERTERS[to].detect(dir), label).toBe(true);
      const joined = target.rules.map((r) => r.content).join("\n");
      for (const rule of source.rules) expect(joined, label).toContain(rule.content.trim().split("\n")[0]);
      for (const skill of source.skills) expect(target.skills.map((s) => s.name), label).toContain(skill.name);
      expect(roundTripLoss(source, target, result.items).unaccounted, label).toEqual([]);
      const second = CONVERTERS[to].export(dir, source, {});
      expect(blockedNames(second.items), label).toEqual(blockedNames(result.items));
    }
  });
});

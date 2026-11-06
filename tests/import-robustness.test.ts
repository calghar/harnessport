import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { claudeConverter } from "../src/converters/claude.js";
import { copilotConverter } from "../src/converters/copilot.js";
import { cursorConverter } from "../src/converters/cursor.js";
import { opencodeConverter } from "../src/converters/opencode.js";

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "import-robustness-"));
  fs.mkdirSync(path.join(home, ".claude", "agents"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

const agentsDir = () => path.join(home, ".claude", "agents");

describe("claude import with malformed frontmatter", () => {
  it("reports the bad agent as blocked and imports the rest", () => {
    fs.writeFileSync(
      path.join(agentsDir(), "bad.md"),
      "---\nname: bad\ndescription: Use when: this is: invalid\n  - [broken\n---\nbody\n",
    );
    fs.writeFileSync(
      path.join(agentsDir(), "good.md"),
      "---\nname: good\ndescription: fine\n---\nGood body\n",
    );

    const config = claudeConverter.import(home);

    expect(config.agents.map((a) => a.name)).toEqual(["good"]);
    const blocked = config.items.filter(
      (i) => i.status === "blocked" && i.kind === "agent",
    );
    expect(blocked).toHaveLength(1);
    expect(blocked[0].phase).toBe("import");
    expect(blocked[0].reason).toContain("bad.md");
    expect(blocked[0].reason).toMatch(/YAML|Nested mappings|flow/i);
  });

});

const BAD = "---\ndescription: Use when: this is: invalid\n---\nbody\n";
const GOOD = "---\ndescription: fine\n---\nGood body\n";

function put(rel: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(home, rel)), { recursive: true });
  fs.writeFileSync(path.join(home, rel), content);
}

describe("other importers report malformed frontmatter and continue", () => {
  const cases = [
    ["opencode", opencodeConverter, ".opencode/agents/bad.md", ".opencode/agents/good.md", "agent"],
    ["cursor", cursorConverter, ".cursor/agents/bad.md", ".cursor/agents/good.md", "agent"],
    ["copilot", copilotConverter, ".github/agents/bad.agent.md", ".github/agents/good.agent.md", "agent"],
  ] as const;

  it("opencode, cursor and copilot block the bad agent and import the good one", () => {
    for (const [, converter, badRel, goodRel, kind] of cases) {
      put(badRel, BAD);
      put(goodRel, GOOD);

      const config = converter.import(home);

      expect(config.agents).toHaveLength(1);
      const blocked = config.items.filter((i) => i.status === "blocked" && i.kind === kind);
      expect(blocked).toHaveLength(1);
      expect(blocked[0].reason).toContain(path.basename(badRel));
      expect(blocked[0].reason).toContain("YAML");
      fs.rmSync(path.join(home, badRel));
      fs.rmSync(path.join(home, goodRel));
    }
  });
});

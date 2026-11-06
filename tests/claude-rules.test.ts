import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as fs from "node:fs";
import * as os from "node:os";
import { claudeConverter } from "../src/converters/claude.js";
import { cursorConverter } from "../src/converters/cursor.js";
import type { HarnessConfig } from "../src/schema.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Mirrors features/claude-rule-scoping.feature.

const _SAMPLE = path.resolve(HERE, "fixtures", "sample-project");

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "harnessport-cr-"));
}

function write(dir: string, rel: string, content: string): void {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

function configWith(rules: HarnessConfig["rules"]): HarnessConfig {
  return {
    rules, agents: [], skills: [], commands: [],
    mcpServers: [], permissions: [], hooks: [], formatters: [], items: [],
  };
}

/** Read every emitted file back, keyed by path relative to the export root. */
function _readTree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[path.relative(dir, p)] = fs.readFileSync(p, "utf-8");
    }
  };
  walk(dir);
  return out;
}

describe("Requirement: File-scoped rules keep their scope", () => {
  it("paths frontmatter imports as globs", () => {
    const dir = tmpDir();
    write(dir, ".claude/rules/api.md", "---\npaths:\n  - src/api/**/*.ts\n---\n\nValidate input.");
    const config = claudeConverter.import(dir);
    const rule = config.rules.find((r) => r.content.includes("Validate input"));
    expect(rule?.globs).toContain("src/api/**/*.ts");
  });

  it("A glob-scoped rule exports to .claude/rules", () => {
    const dir = tmpDir();
    claudeConverter.export(
      dir,
      configWith([{ content: "TS rules", globs: "src/**/*.ts", source: "typescript.mdc" }]),
      {},
    );
    const emitted = fs.readFileSync(path.join(dir, ".claude", "rules", "typescript.md"), "utf-8");
    expect(emitted).toContain("src/**/*.ts");
    expect(emitted).toContain("paths");
    expect(emitted).toContain("TS rules");
  });

  it("Cursor glob scoping survives a round trip through claude", () => {
    const cursorSrc = tmpDir();
    write(
      cursorSrc,
      ".cursor/rules/typescript.mdc",
      "---\ndescription: ''\nglobs: src/**/*.ts\nalwaysApply: false\n---\n\nUse strict mode.",
    );

    const claudeDir = tmpDir();
    claudeConverter.export(claudeDir, cursorConverter.import(cursorSrc), {});

    const backDir = tmpDir();
    cursorConverter.export(backDir, claudeConverter.import(claudeDir), {});

    const roundTripped = cursorConverter.import(backDir);
    const rule = roundTripped.rules.find((r) => r.content.includes("Use strict mode"));
    expect(rule?.globs).toBe("src/**/*.ts");
  });

});


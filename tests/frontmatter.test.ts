import { describe, it, expect } from "vitest";
import { parseFrontmatter, serializeFrontmatter } from "../src/utils.js";

// These cases are the recorded behaviour of gray-matter@4.0.3, which this module
// replaced to drop the vulnerable js-yaml@3.x it pinned (GHSA-h67p-54hq-rp68).
// They exist to prove the swap changed no observable output.
describe("parseFrontmatter", () => {
  const cases: Array<[string, string, Record<string, unknown>, string]> = [
    ["no frontmatter", "just body text\n", {}, "just body text"],
    ["empty input", "", {}, ""],
    ["normal", "---\nname: foo\ndesc: bar\n---\n\nBody here\n", { name: "foo", desc: "bar" }, "Body here"],
    ["array value", "---\ntools:\n  - Bash\n  - Edit\n---\nbody", { tools: ["Bash", "Edit"] }, "body"],
    ["empty block", "---\n---\nbody", {}, "body"],
    ["leading BOM", "﻿---\nname: x\n---\nbody", { name: "x" }, "body"],
    ["hr in body", "---\nname: x\n---\nbody\n\n---\n\nmore", { name: "x" }, "body\n\n---\n\nmore"],
    ["CRLF", "---\r\nname: x\r\n---\r\nbody", { name: "x" }, "body"],
  ];

  for (const [label, input, data, content] of cases) {
    it(`matches recorded gray-matter output: ${label}`, () => {
      const result = parseFrontmatter(input);
      expect(result.data).toEqual(data);
      expect(result.content).toBe(content);
    });
  }

  it("ignores a non-object frontmatter block rather than throwing", () => {
    expect(parseFrontmatter("---\n- a\n- b\n---\nbody").data).toEqual({});
  });

  it("does not treat a mid-file --- as frontmatter", () => {
    const result = parseFrontmatter("intro\n\n---\n\ntail");
    expect(result.data).toEqual({});
    expect(result.content).toBe("intro\n\n---\n\ntail");
  });
});

describe("serializeFrontmatter", () => {
  it("matches recorded gray-matter output for scalars and arrays", () => {
    expect(serializeFrontmatter({ name: "foo", tools: ["Bash", "Edit"] }, "Body here")).toBe(
      "---\nname: foo\ntools:\n  - Bash\n  - Edit\n---\nBody here\n",
    );
  });

  // yaml quotes only where YAML requires it, where js-yaml quoted more eagerly.
  // Quote style is cosmetic; what must hold is that every value survives a round trip.
  it("emits values that parse back unchanged, however they are quoted", () => {
    const tricky = {
      "allowed-tools": "Bash(npm run:*)",
      desc: "Run: the thing",
      glob: "*.{js,ts}",
      url: "https://x.example.com/mcp",
      tok: "${GITHUB_TOKEN}",
      at: "@AGENTS.md",
      hash: "#not-a-comment",
      num: "007",
    };
    expect(parseFrontmatter(serializeFrontmatter(tricky, "b")).data).toEqual(tricky);
  });

  it("drops null and undefined keys", () => {
    expect(serializeFrontmatter({ a: "1", b: null, c: undefined }, "x")).toBe("---\na: '1'\n---\nx\n");
  });

  it("returns the bare body when every key is empty", () => {
    expect(serializeFrontmatter({ a: null }, "just body")).toBe("just body");
  });

  it("normalises trailing newlines to exactly one", () => {
    expect(serializeFrontmatter({ n: "x" }, "body\n\n\n")).toBe("---\nn: x\n---\nbody\n");
  });

  it("round-trips through parseFrontmatter", () => {
    const data = { name: "agent", model: "opus", tools: ["Bash", "Read"] };
    const parsed = parseFrontmatter(serializeFrontmatter(data, "The body."));
    expect(parsed.data).toEqual(data);
    expect(parsed.content).toBe("The body.");
  });
});

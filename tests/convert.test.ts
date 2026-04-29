import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { claudeConverter } from "../src/converters/claude.js";
import { opencodeConverter } from "../src/converters/opencode.js";
import { cursorConverter } from "../src/converters/cursor.js";
import { windsurfConverter } from "../src/converters/windsurf.js";
import { copilotConverter } from "../src/converters/copilot.js";
import { codexConverter } from "../src/converters/codex.js";

const FIXTURE = path.resolve(__dirname, "fixtures", "sample-project");

describe("claude importer", () => {
  it("detects claude config", () => {
    expect(claudeConverter.detect(FIXTURE)).toBe(true);
  });

  it("imports all config types", () => {
    const config = claudeConverter.import(FIXTURE);
    expect(config.rules.length).toBe(1);
    expect(config.agents.length).toBe(2);
    expect(config.skills.length).toBe(1);
    expect(config.commands.length).toBe(1);
    expect(config.mcpServers.length).toBe(2);
    expect(config.permissions.length).toBe(4);
    expect(config.formatters.length).toBe(1);
    expect(config.formatters[0].command).toContain("prettier");
  });

  it("parses agent frontmatter correctly", () => {
    const config = claudeConverter.import(FIXTURE);
    const backend = config.agents.find((a) => a.name === "backend");
    expect(backend).toBeDefined();
    if (!backend) return;
    expect(backend.model).toBe("opus");
    expect(backend.skills).toContain("testing");
    expect(backend.tools).toContain("Bash");
  });

  it("parses MCP servers with env vars", () => {
    const config = claudeConverter.import(FIXTURE);
    const github = config.mcpServers.find((s) => s.name === "github");
    expect(github).toBeDefined();
    if (!github) return;
    expect(github.type).toBe("stdio");
    expect(github.env?.GITHUB_PERSONAL_ACCESS_TOKEN).toBe(
      "${GITHUB_PERSONAL_ACCESS_TOKEN}",
    );
  });

  it("parses HTTP MCP server", () => {
    const config = claudeConverter.import(FIXTURE);
    const search = config.mcpServers.find((s) => s.name === "search");
    expect(search).toBeDefined();
    if (!search) return;
    expect(search.type).toBe("http");
    expect(search.url).toContain("search.example.com");
    expect(search.headers?.Authorization).toContain("${API_TOKEN}");
  });

  it("parses permissions correctly", () => {
    const config = claudeConverter.import(FIXTURE);
    const webFetch = config.permissions.filter((p) => p.tool === "WebFetch");
    expect(webFetch.length).toBe(1);
    expect(webFetch.some((p) => p.pattern === "domain:github.com")).toBe(true);
    const bash = config.permissions.filter((p) => p.tool === "Bash");
    expect(bash.length).toBe(2);
  });
});

describe("opencode exporter", () => {
  it("dry-run produces correct file count", () => {
    const config = claudeConverter.import(FIXTURE);
    const result = opencodeConverter.export("/tmp/test-out", config, true);
    // rules(1) + agents(2) + skills(1) + commands(1) + opencode.json(1) = 6
    expect(result.filesWritten.length).toBe(6);
  });

  it("warns about dropped skills references", () => {
    const config = claudeConverter.import(FIXTURE);
    const result = opencodeConverter.export("/tmp/test-out", config, true);
    expect(result.warnings.some((w) => w.includes("skills"))).toBe(true);
  });
});

describe("cursor exporter", () => {
  it("dry-run produces rules and mcp files", () => {
    const config = claudeConverter.import(FIXTURE);
    const result = cursorConverter.export("/tmp/test-cursor", config, true);
    expect(result.filesWritten.some((f) => f.endsWith(".mdc"))).toBe(true);
    expect(result.filesWritten.some((f) => f.endsWith("mcp.json"))).toBe(true);
  });

  it("exports agents, skills, and commands", () => {
    const config = claudeConverter.import(FIXTURE);
    const result = cursorConverter.export("/tmp/test-cursor", config, true);
    expect(result.filesWritten.some((f) => f.includes("/agents/"))).toBe(true);
    expect(result.filesWritten.some((f) => f.includes("SKILL.md"))).toBe(true);
    expect(result.filesWritten.some((f) => f.includes("/commands/"))).toBe(true);
  });
});

describe("windsurf exporter", () => {
  it("dry-run produces rules and skills", () => {
    const config = claudeConverter.import(FIXTURE);
    const result = windsurfConverter.export("/tmp/test-windsurf", config, true);
    expect(result.filesWritten.some((f) => f.includes(".windsurf/rules/"))).toBe(true);
    expect(result.filesWritten.some((f) => f.includes("SKILL.md"))).toBe(true);
  });
});

describe("copilot exporter", () => {
  it("dry-run produces copilot-instructions.md", () => {
    const config = claudeConverter.import(FIXTURE);
    const result = copilotConverter.export("/tmp/test-copilot", config, true);
    expect(
      result.filesWritten.some((f) => f.includes("copilot-instructions.md")),
    ).toBe(true);
  });

  it("exports MCP, agents, skills, prompts, and hooks", () => {
    const config = claudeConverter.import(FIXTURE);
    const result = copilotConverter.export("/tmp/test-copilot", config, true);
    expect(result.filesWritten.some((f) => f.includes("mcp-config.json"))).toBe(true);
    expect(result.filesWritten.some((f) => f.includes(".agent.md"))).toBe(true);
    expect(result.filesWritten.some((f) => f.includes("SKILL.md"))).toBe(true);
  });
});

describe("codex exporter", () => {
  it("dry-run produces AGENTS.md and skills", () => {
    const config = claudeConverter.import(FIXTURE);
    const result = codexConverter.export("/tmp/test-codex", config, true);
    expect(result.filesWritten.some((f) => f.endsWith("AGENTS.md"))).toBe(true);
    expect(result.filesWritten.some((f) => f.includes("SKILL.md"))).toBe(true);
  });

  it("warns about MCP and commands", () => {
    const config = claudeConverter.import(FIXTURE);
    const result = codexConverter.export("/tmp/test-codex", config, true);
    expect(result.warnings.some((w) => w.includes("MCP"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("command"))).toBe(true);
  });
});

describe("round-trip: claude -> opencode -> claude", () => {
  it("preserves MCP server count through round-trip", () => {
    const original = claudeConverter.import(FIXTURE);
    expect(original.mcpServers.length).toBe(2);
    expect(original.mcpServers.every((s) => s.name)).toBe(true);
  });
});

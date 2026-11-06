import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { claudeConverter } from "../src/converters/claude.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const FIXTURE = path.resolve(HERE, "fixtures", "sample-project");

describe("claude importer", () => {

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
});

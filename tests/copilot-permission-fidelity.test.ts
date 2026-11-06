import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { copilotConverter } from "../src/converters/copilot.js";
import type { HarnessConfig } from "../src/schema.js";

const tmpDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "harnessport-cpf-"));

const base: HarnessConfig = {
  rules: [], agents: [], skills: [], commands: [],
  mcpServers: [], permissions: [], hooks: [], formatters: [], items: [],
};

const exportItems = (config: Partial<HarnessConfig>, dir = tmpDir()) =>
  copilotConverter.export(dir, { ...base, ...config }, {}).items;

describe("Requirement: Copilot permission reasons name the user-level files", () => {
  it("An allow is dropped with the user-level reason", () => {
    const dir = tmpDir();
    const [item] = exportItems({ permissions: [{ tool: "Bash", pattern: "npm test", action: "allow" }] }, dir);
    expect(item.status).toBe("dropped");
    expect(item.reason).toContain("~/.copilot/permissions-config.json");
    expect(item.reason).toContain("never writes");
    expect(fs.existsSync(path.join(dir, ".github", "copilot"))).toBe(false);
  });

  it("A deny is blocked with the user-level reason", () => {
    const [item] = exportItems({ permissions: [{ tool: "Bash", pattern: "rm *", action: "deny" }] });
    expect(item.status).toBe("blocked");
    expect(item.reason).toContain("~/.copilot/settings.json");
  });
});

describe("Requirement: Copilot hook reasons match the documented events and failure modes", () => {
  const hookItem = (hook: HarnessConfig["hooks"][number]) =>
    exportItems({ hooks: [hook] }).find((i) => i.kind === "hook");

  it("A PermissionRequest guardrail names both surfaces", () => {
    const item = hookItem({ event: "PermissionRequest", command: "./perm.sh" });
    expect(item?.status).toBe("blocked");
    expect(item?.reason).toContain("permissionRequest");
    expect(item?.reason).toContain("cloud");
    expect(item?.reason).not.toContain("has no permission-request hook event");
  });

  it("A failClosed PreToolUse guardrail states the real failure modes", () => {
    const item = hookItem({ event: "PreToolUse", command: "./guard.sh", failClosed: true });
    expect(item?.status).toBe("blocked");
    expect(item?.reason).toContain("exit 2");
    expect(item?.reason).toContain("timeout");
    expect(item?.reason).not.toContain("cannot make a failing hook block the action");
  });

  it("A failClosed non-guardrail hook is lossy and fail-open", () => {
    const item = hookItem({ event: "PostToolUse", command: "./after.sh", failClosed: true });
    expect(item?.status).toBe("lossy");
    expect(item?.reason).toContain("fail-open");
  });
});

describe("Requirement: Copilot project MCP lives in .github/mcp.json", () => {
  const fsServer = { name: "fs", type: "stdio" as const, command: "npx", args: ["mcp-fs"] };

  it("Export then import round-trips through .github/mcp.json", () => {
    const dir = tmpDir();
    copilotConverter.export(dir, { ...base, mcpServers: [fsServer] }, {});
    const file = JSON.parse(fs.readFileSync(path.join(dir, ".github", "mcp.json"), "utf-8"));
    expect(Object.keys(file.mcpServers)).toEqual(["fs"]);
    expect(fs.existsSync(path.join(dir, ".copilot", "mcp-config.json"))).toBe(false);
    expect(copilotConverter.import(dir).mcpServers.map((s) => s.name)).toEqual(["fs"]);
  });

  it("A directory holding only .github/mcp.json is detected", () => {
    const dir = tmpDir();
    fs.mkdirSync(path.join(dir, ".github"));
    fs.writeFileSync(path.join(dir, ".github", "mcp.json"), "{}");
    expect(copilotConverter.detect(dir)).toBe(true);
  });
});

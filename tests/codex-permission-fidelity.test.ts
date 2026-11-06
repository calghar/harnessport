import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { codexConverter } from "../src/converters/codex.js";
import type { HarnessConfig, Hook, PermissionEntry } from "../src/schema.js";


function config(over: Partial<HarnessConfig>): HarnessConfig {
  return {
    rules: [], agents: [], skills: [], commands: [], mcpServers: [],
    permissions: [], hooks: [], formatters: [], items: [], ...over,
  };
}

function exportTo(over: Partial<HarnessConfig>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harnessport-codex-"));
  const { items, filesWritten } = codexConverter.export(dir, config(over), {});
  const hooksPath = path.join(dir, ".codex", "hooks.json");
  const hooksFile = fs.existsSync(hooksPath) ? JSON.parse(fs.readFileSync(hooksPath, "utf-8")) : undefined;
  return { dir, items, filesWritten, hooksFile };
}

const perm = (action: PermissionEntry["action"], pattern: string): PermissionEntry =>
  ({ tool: "Bash", pattern, action });
const hook = (over: Partial<Hook>): Hook =>
  ({ event: "PostToolUse", matcher: "Bash", command: "./h.sh", ...over });

describe("Requirement: Codex permission reports name prefix rules and the unverified path", () => {
  it("A deny is blocked with an accurate reason", () => {
    const { items, filesWritten } = exportTo({ permissions: [perm("deny", "rm -rf *")] });
    const [item] = items.filter((i) => i.kind === "permission");
    expect(item.status).toBe("blocked");
    expect(item.reason).toContain("prefix_rule");
    expect(item.reason).toContain("UNVERIFIED");
    expect(item.reason).not.toContain("no project-level permission config");
    expect(filesWritten).toEqual([]);
  });

  it("An allow is dropped with an accurate reason", () => {
    const { items } = exportTo({ permissions: [perm("allow", "ls *")] });
    const [item] = items.filter((i) => i.kind === "permission");
    expect(item.status).toBe("dropped");
    expect(item.reason).toContain("prefix_rule");
    expect(item.reason).toContain("UNVERIFIED");
  });
});

describe("Requirement: A hook timeout is written and reported lossy with an unverified unit", () => {
  it("A hook with a timeout", () => {
    const { items, hooksFile } = exportTo({ hooks: [hook({ timeout: 30 })] });
    expect(hooksFile.hooks.PostToolUse[0].hooks[0].timeout).toBe(30);
    const [item] = items.filter((i) => i.kind === "hook");
    expect(item.status).toBe("lossy");
    expect(item.reason).toContain("UNVERIFIED");
    expect(item.reason).not.toContain("no verified hook timeout field");
  });

  it("A hook without a timeout", () => {
    const { items, hooksFile } = exportTo({ hooks: [hook({})] });
    expect(hooksFile.hooks.PostToolUse[0].hooks[0]).not.toHaveProperty("timeout");
    expect(items.find((i) => i.kind === "hook")?.status).toBe("exact");
  });
});

describe("Requirement: The fail-closed limitation is marked unverified", () => {
  it("A fail-closed guardrail", () => {
    const { items, hooksFile } = exportTo({ hooks: [hook({ event: "PreToolUse", failClosed: true })] });
    const [item] = items.filter((i) => i.kind === "hook");
    expect(item.status).toBe("blocked");
    expect(item.reason).toContain("UNVERIFIED");
    expect(hooksFile).toBeUndefined();
  });
});

describe("Requirement: The hooks file keeps the matcher-group shape", () => {
  it("A Bash hook", () => {
    const { hooksFile } = exportTo({ hooks: [hook({ event: "PreToolUse", command: "./g.sh" })] });
    expect(hooksFile.hooks.PreToolUse[0].matcher).toBe("Bash");
    expect(hooksFile.hooks.PreToolUse[0].hooks[0]).toEqual({ type: "command", command: "./g.sh" });
  });
});

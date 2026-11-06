import { describe, it, expect } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { opencodeConverter } from "../src/converters/opencode.js";
import type { FidelityItem, HarnessConfig, PermissionAction } from "../src/schema.js";

// Mirrors openspec/changes/opencode-permission-fidelity/specs/opencode-permissions/spec.md.

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "harnessport-ocpf-"));
}

function config(over: Partial<HarnessConfig>): HarnessConfig {
  return {
    rules: [], agents: [], skills: [], commands: [],
    mcpServers: [], permissions: [], hooks: [], formatters: [], items: [],
    ...over,
  };
}

type Perm = [tool: string, pattern: string, action: PermissionAction];

function exportPerms(...perms: Perm[]): {
  items: FidelityItem[];
  permission: Record<string, unknown> | undefined;
  raw: string;
} {
  const dir = tmpDir();
  const { items } = opencodeConverter.export(
    dir,
    config({ permissions: perms.map(([tool, pattern, action]) => ({ tool, pattern, action })) }),
    {},
  );
  const file = path.join(dir, "opencode.json");
  const raw = fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : "";
  return { items, permission: raw ? JSON.parse(raw).permission : undefined, raw };
}

const permItem = (items: FidelityItem[], name: string) =>
  items.find((i) => i.kind === "permission" && i.name === name);

describe("Requirement: WebSearch is written as the websearch key", () => {
  it.each(["allow", "deny", "ask"] as const)("WebSearch %s is written exact", (action) => {
    const { items, permission } = exportPerms(["WebSearch", "*", action]);
    expect(permission?.websearch).toBe(action);
    expect(permItem(items, "WebSearch(*)")?.status).toBe("exact");
  });
});

describe("Requirement: A shorthand-only key carries the strictest action", () => {
  it("lsp is written as a string", () => {
    expect(exportPerms(["lsp", "*", "deny"]).permission?.lsp).toBe("deny");
  });

  it("A patterned deny on lsp is blocked", () => {
    const { items, permission } = exportPerms(["lsp", "src/*", "deny"]);
    expect(permItem(items, "lsp(src/*)")?.status).toBe("blocked");
    expect(permission?.lsp).toBeUndefined();
  });

  it("list is not granular", () => {
    const { items } = exportPerms(["list", "src/*", "ask"]);
    expect(permItem(items, "list(src/*)")?.status).toBe("blocked");
  });

  it("The strictest action wins", () => {
    const { permission } = exportPerms(["WebFetch", "*", "allow"], ["WebFetch", "*", "deny"]);
    expect(permission?.webfetch).toBe("deny");
  });
});

describe("Requirement: A domain pattern is reported unsupported", () => {
  it("A denied domain is blocked", () => {
    const { items, raw } = exportPerms(["WebFetch", "domain:evil.test", "deny"]);
    expect(permItem(items, "WebFetch(domain:evil.test)")?.status).toBe("blocked");
    expect(raw).not.toContain("https://evil.test");
  });

  it("An allowed domain is dropped", () => {
    const { items, permission } = exportPerms(["WebFetch", "domain:github.com", "allow"]);
    expect(permItem(items, "WebFetch(domain:github.com)")?.status).toBe("dropped");
    expect(permission?.webfetch).toBeUndefined();
  });
});

describe("Requirement: A hook reason names the OpenCode plugin path", () => {
  it("A PreToolUse reason names plugins", () => {
    const { items } = opencodeConverter.export(
      tmpDir(),
      config({ hooks: [{ event: "PreToolUse", matcher: "Bash", command: "./h.sh" }] }),
      {},
    );
    const reason = items.find((i) => i.kind === "hook")?.reason ?? "";
    expect(reason).toContain("plugin");
    expect(reason).toContain("tool.execute.before");
    expect(reason).not.toContain("supports only formatters");
  });
});

describe("Requirement: Documented formatter fields are imported or reported", () => {
  function importFormatter(entry: Record<string, unknown>) {
    const dir = tmpDir();
    fs.writeFileSync(
      path.join(dir, "opencode.json"),
      JSON.stringify({ formatter: { prettier: entry } }),
    );
    return opencodeConverter.import(dir);
  }
  const fmtItem = (c: HarnessConfig) =>
    c.items.find((i) => i.phase === "import" && i.kind === "formatter" && i.name === "prettier");

  it("A disabled formatter is not imported as active", () => {
    const c = importFormatter({ disabled: true, command: ["prettier", "--write", "$FILE"] });
    expect(c.formatters).toEqual([]);
    expect(fmtItem(c)?.status).toBe("dropped");
  });

  it("A formatter environment is reported lossy", () => {
    const c = importFormatter({
      environment: { A: "1" },
      command: ["prettier", "--write", "$FILE"],
      extensions: [".ts"],
    });
    expect(c.formatters).toHaveLength(1);
    expect(fmtItem(c)?.status).toBe("lossy");
  });
});

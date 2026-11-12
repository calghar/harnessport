import { describe, it, expect, vi } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { cursorConverter } from "../src/converters/cursor.js";
import { claudeConverter } from "../src/converters/claude.js";
import type { ExportOptions } from "../src/converters/types.js";
import type { HarnessConfig } from "../src/schema.js";

vi.setConfig({ testTimeout: 30_000 });

const TSX = path.resolve("node_modules/.bin/tsx");
const CLI = path.resolve("src/index.ts");
const SAMPLE = path.resolve("tests/fixtures/sample-project");
const WRAPPER = ".cursor/hooks/harnessport-model-log.mjs";
const LOG = ".cursor/harnessport-model.jsonl";
const REASON = "the harnessport model log is Cursor-only and has no Claude hook mapping";

const tmpDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "harnessport-modellog-"));
const read = (dir: string, rel: string): string => fs.readFileSync(path.join(dir, rel), "utf-8");
const config = (stopCommand?: string): HarnessConfig => ({
  rules: [], agents: [], skills: [], commands: [], mcpServers: [], permissions: [],
  hooks: stopCommand ? [{ event: "Stop", command: stopCommand }] : [],
  formatters: [], items: [],
});
const claudeProject = (): string => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, ".claude"));
  fs.writeFileSync(path.join(dir, ".claude", "settings.json"), "{}");
  return dir;
};
const cli = (...args: string[]) => spawnSync(TSX, [CLI, "convert", ...args], { encoding: "utf-8" });
const files = (dir: string): string[] =>
  fs.readdirSync(dir, { recursive: true, encoding: "utf-8" }).filter((f) => fs.statSync(path.join(dir, f)).isFile()).sort();
const wrapperRun = (stdin: string, dir = tmpDir()) => {
  cursorConverter.export(dir, config(), { logModel: true });
  const r = spawnSync("node", [WRAPPER], { cwd: dir, input: stdin, encoding: "utf-8" });
  return { dir, ...r };
};

describe("Cursor model log export", () => {
  it("writes the wrapper, the stop entry and an exact item for a project export", () => {
    const dir = claudeProject();
    const r = cli("--from", "claude", "--to", "cursor", "--source", dir, "--log-model", "--json");
    expect(fs.existsSync(path.join(dir, WRAPPER))).toBe(true);
    expect(JSON.parse(read(dir, ".cursor/hooks.json")).hooks.stop).toEqual([{ command: `node ${WRAPPER}` }]);
    expect(JSON.parse(r.stdout).items).toContainEqual(
      expect.objectContaining({ kind: "hook", name: "model-log", status: "exact" }),
    );
  });

  it("uses the quoted absolute path at user level", () => {
    const home = tmpDir();
    cursorConverter.export(home, config(), { logModel: true, homeDir: home } as ExportOptions);
    expect(JSON.parse(read(home, ".cursor/hooks.json")).hooks.stop).toEqual([
      { command: `node "${path.join(home, WRAPPER)}"` },
    ]);
  });

  it("writes nothing on a dry run", () => {
    const dir = claudeProject();
    cli("--from", "claude", "--to", "cursor", "--source", dir, "--log-model", "--dry-run");
    expect(fs.existsSync(path.join(dir, ".cursor"))).toBe(false);
  });

  it("keeps the default export byte-identical and free of the model log", () => {
    const withoutFlag = tmpDir();
    const explicitOff = tmpDir();
    const withFlag = tmpDir();
    const imported = claudeConverter.import(SAMPLE);
    cursorConverter.export(withoutFlag, imported, {});
    cursorConverter.export(explicitOff, imported, { logModel: false });
    cursorConverter.export(withFlag, imported, { logModel: true });
    const names = files(withoutFlag);
    expect(files(explicitOff)).toEqual(names);
    for (const f of names) {
      expect(read(explicitOff, f)).toBe(read(withoutFlag, f));
      expect(read(withoutFlag, f)).not.toContain("harnessport-model-log");
    }
    expect(files(withFlag)).toEqual([...names, WRAPPER].sort());
  });

  it("keeps relayed Stop entries first and guard numbering unchanged", () => {
    const dir = tmpDir();
    cursorConverter.export(dir, config("./stop.sh"), { logModel: true });
    expect(JSON.parse(read(dir, ".cursor/hooks.json")).hooks.stop).toEqual([
      { command: "node .cursor/hooks/harnessport-stop.mjs" },
      { command: `node ${WRAPPER}` },
    ]);
    expect(files(dir)).toContain(".cursor/hooks/harnessport-stop.mjs");
  });

  it("rejects --log-model for a non-Cursor target and writes nothing", () => {
    const dir = claudeProject();
    const before = files(dir);
    const r = cli("--from", "claude", "--to", "codex", "--source", dir, "--log-model");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("--log-model");
    expect(files(dir)).toEqual(before);
  });
});

describe("Cursor model log wrapper", () => {
  it.each([
    [{ conversation_id: "c-1", generation_id: "g-1", model: "claude-sonnet", model_id: "id-1", extra: 1 },
      ["timestamp", "conversation_id", "generation_id", "model", "model_id"]],
    [{ conversation_id: "c-2", model: "gpt-5", model_id: "id-2" },
      ["timestamp", "conversation_id", "model", "model_id"]],
  ])("appends one record with only the payload fields", (payload, keys) => {
    const { dir, status, stdout } = wrapperRun(JSON.stringify(payload));
    expect(status).toBe(0);
    expect(stdout).toBe("");
    const lines = read(dir, LOG).split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]);
    expect(record.timestamp).toMatch(/Z$/);
    expect(Object.keys(record)).toEqual(keys);
    for (const k of keys.slice(1)) expect(record[k]).toBe((payload as Record<string, unknown>)[k]);
  });

  it.each([["stdin that is not JSON", "nope"], ["stdin that is a JSON array", "[1]"]])(
    "exits 0 with one stderr line for %s",
    (_name, stdin) => {
      const { dir, status, stdout, stderr } = wrapperRun(stdin);
      expect(status).toBe(0);
      expect(stdout).toBe("");
      expect(stderr).toMatch(/^harnessport-model-log: [^\n]*\n$/);
      expect(fs.existsSync(path.join(dir, LOG))).toBe(false);
    },
  );

  it("exits 0 with one stderr line for a read-only .cursor directory", () => {
    const dir = tmpDir();
    cursorConverter.export(dir, config(), { logModel: true });
    fs.chmodSync(path.join(dir, ".cursor"), 0o555);
    const r = spawnSync("node", [WRAPPER], { cwd: dir, input: '{"model":"m"}', encoding: "utf-8" });
    fs.chmodSync(path.join(dir, ".cursor"), 0o755);
    // root ignores directory modes, so the write succeeds there
    if (process.getuid?.() === 0) return;
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/^harnessport-model-log: [^\n]*\n$/);
    expect(fs.existsSync(path.join(dir, LOG))).toBe(false);
  });
});

describe("Cursor model log import", () => {
  it("drops the model log with its reason and maps no Stop hook", () => {
    const dir = tmpDir();
    cursorConverter.export(dir, config(), { logModel: true });
    const imported = cursorConverter.import(dir);
    expect(imported.hooks).toEqual([]);
    expect(imported.items.filter((i) => i.status === "dropped" && i.reason?.includes(REASON))).toHaveLength(1);
    const out = tmpDir();
    claudeConverter.export(out, imported, {});
    const settings = fs.existsSync(path.join(out, ".claude/settings.json")) ? read(out, ".claude/settings.json") : "";
    expect(settings).not.toContain("harnessport-model-log");
  });
});

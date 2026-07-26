## Why

Converting a permission `deny` rule to any target silently produces an `allow` rule, because the
canonical schema has no action field — a rule written to block a command ends up pre-approving it.
More broadly, the tool reports loss as unstructured warning strings, so a caller cannot tell what
converted exactly, what converted with detail dropped, and what did not convert at all.

## What Changes

- **ADDED** `action: "allow" | "ask" | "deny"` on `PermissionEntry` (`src/schema.ts`), defaulting
  to `allow` so existing construction sites stay valid.
- **ADDED** `FidelityItem` — `{ phase, kind, name, status, reason? }` where `status` is
  `exact | lossy | blocked` — as the single representation of conversion fidelity.
- **MODIFIED / BREAKING** `ExportResult` (`src/converters/types.ts`) drops `warnings: string[]` in
  favour of `items: FidelityItem[]`. All six converters return items.
- **MODIFIED / BREAKING** `HarnessConfig` (`src/schema.ts`) drops `warnings: string[]` in favour of
  `items: FidelityItem[]`, so import-side loss enters the same report. Today only
  `src/converters/codex.ts:94` populates it.
- **MODIFIED** `src/converters/claude.ts` reads `permissions.allow`, `.deny`, and `.ask` from both
  `.claude/settings.json` and `.claude/settings.local.json`, and writes each back to its matching
  key. It currently reads only `allow`, only from `settings.local.json`.
- **MODIFIED** `src/converters/opencode.ts` preserves the action value when importing OpenCode's
  `permission` block. `parsePermissions` currently discards it via `Object.keys`.
- **MODIFIED / BREAKING** `src/utils.ts` `generateDropWarnings` returns `FidelityItem[]` instead of
  `string[]`, and is renamed `generateDropItems`. Four callers: cursor, windsurf, copilot, codex.
- **ADDED / BREAKING** A permission whose `action` is `deny` or `ask` and whose target cannot
  represent it is emitted as a `blocked` item and **is not written in a weakened form**. There is no
  flag that downgrades it.
- **ADDED / BREAKING** `convert` exits `2` when any item is `blocked`. Exit stays `0` when items are
  merely `lossy`.
- **ADDED** `--json` on `convert`, emitting the item list for scripting.
- **FIXED** `--version` reads from `package.json` rather than the hardcoded `0.1.0`
  (`src/index.ts:30`).

## Capabilities

### Modified Capabilities

None. `openspec/specs/` is empty; this is the first change to define specs.

### New Capabilities

- `permission-fidelity`: how permission actions are imported, represented, and either written or
  refused per target.
- `conversion-reporting`: how per-item conversion fidelity is classified, surfaced on stdout and as
  JSON, and mapped to process exit codes.

## Blast radius

GATE 1 measured by grep, confirmed by reading each site. The LSP was tried first and rejected: it
returned 2 references for `parseFrontmatter` where grep found 12 across 6 files, so it under-reports
on this repo and its counts are not used here.

Union of affected files is **all 10 source files** — the entire `src/` tree. This is expected for a
canonical-schema change and is surfaced rather than absorbed silently.

- `ExportResult` — constructed and returned by all six converters (`claude.ts:378`,
  `opencode.ts:494`, `cursor.ts:209`, `windsurf.ts:179`, `copilot.ts:306`, `codex.ts:141`), defined
  at `types.ts:13`, consumed at `index.ts:97-111`.
- `config.permissions` — produced by `claude.ts:328` and `opencode.ts` (`importMcpAndConfig`);
  hardcoded `[]` by the cursor, windsurf, copilot, and codex importers; read at `claude.ts:257,284`,
  `opencode.ts:331,481`, `utils.ts:389`, `index.ts:88`.
- `generateDropWarnings` — defined `utils.ts:365`; four callers (`cursor.ts:204`, `windsurf.ts:172`,
  `copilot.ts:295`, `codex.ts:130`). Not called by claude or opencode, which is why their loss goes
  unreported today.
- `HarnessConfig.warnings` — every importer sets it, every exporter spreads it via
  `[...config.warnings]`; only `codex.ts:94` ever makes it non-empty.

Do-not-touch boundaries for this change:

- Emitted file **paths and directory layout** stay exactly as they are. This change alters what is
  refused and what is reported, not where files land. Rule scoping and `.claude/rules/` are Phase 3.
- Frontmatter serialization (`serializeFrontmatter`) stays as-is; it was settled in Phase 0.
- No new target harnesses.
- `tests/fixtures/sample-project/` keeps its current shape; new fixtures are added alongside it
  rather than editing it, since every existing test asserts against its counts.

## Impact

**On-disk format.** For claude targets, `.claude/settings.local.json` gains `deny` and `ask` keys
alongside `allow`, and permissions sourced from `.claude/settings.json` are written back there
rather than being collapsed into the local file. Files written by 0.1.x remain readable — this
change widens what is read, so no existing input becomes invalid.

**Security posture.** This change exists to stop a conversion weakening a posture. A `deny` is
never emitted as an `allow`; where a target cannot represent it, the item is refused and reported,
and the run exits 2. Because four of the six targets (cursor, windsurf, copilot, codex) have no
permission concept at all, blocking is scoped to the individual item so the rest of the conversion
still completes — otherwise those targets would be permanently unreachable for any user holding a
single deny rule.

**CLI surface.** `convert` gains `--json`; exit code 2 becomes possible where only 0 and 1 were
before. Stdout gains a grouped fidelity summary in place of a flat warning list. Any script parsing
the current `⚠ ` lines will need updating; `--json` is the stable surface going forward.

**API.** `ExportResult` and `HarnessConfig` are exported types, and `dist/index.d.ts` ships. Anyone
importing the package as a library sees breaking type changes. The package exposes a `bin` and no
`exports` map, so CLI use is the documented path; the type break is real but narrow.

**Dependencies.** None added or removed. `zod` remains types-only for this change; Phase 2 either
uses it to validate untrusted JSON at the read boundary (finding M3) or removes it.

**Version.** 0.2.0.

## Why

`writeIfNotDry` calls `fs.writeFileSync` unconditionally, and `--target` defaults to `--source`, so
converting into a repository that already holds config destroys hand-written files in place with no
prompt, no backup, and no recovery. Separately, several exporters derive output filenames by
slugifying a name, and nothing detects two inputs landing on one path — the second silently
overwrites the first.

## What Changes

- **ADDED** Conflict detection in `src/utils.ts` `writeIfNotDry`. A target file that exists with
  different content is refused; identical content is a no-op; a missing file is written.
- **ADDED / BREAKING** `--force` on `convert`, which writes over a conflicting file after copying it
  to `<file>.bak`.
- **MODIFIED / BREAKING** `writeIfNotDry` takes a `WriteContext` in place of the `dryRun` boolean and
  returns whether the path was written. The context carries `dryRun`, `force`, and the accumulated
  conflict items. 22 call sites across `src/utils.ts` and all six converters.
- **MODIFIED / BREAKING** `Converter.export` takes `options?: { dryRun?, force? }` in place of
  `dryRun?: boolean`.
- **ADDED** `uniqueSlugs` in `src/utils.ts`, disambiguating output filenames that collide after
  slugification, reporting each disambiguation as `lossy`.
- **FIXED** `inferFormatterName` (`src/converters/opencode.ts`) maps `black`, `isort`, `autopep8`,
  and `yapf` all to the literal name `ruff`, so two Python formatters collapse to one key and one is
  lost. Each formatter keeps its own name.
- **FIXED** `copilot.exportRules` names every rule lacking a `source` `rule.instructions.md`, so N
  such rules collapse to one file.
- **MODIFIED** `readFileIfExists` and `readJsonIfExists` (`src/utils.ts`) distinguish a missing file
  from an unreadable or malformed one. A parse error or permission error surfaces as a `blocked`
  import item instead of being indistinguishable from absence.

## Capabilities

### Modified Capabilities

- `conversion-reporting`: adds the requirement that a refused write is reported and fails the run.

### New Capabilities

- `safe-writes`: when a conversion may overwrite existing files, and what it does instead.
- `output-naming`: how output filenames are derived and what happens when two inputs collide.

## Blast radius

GATE 1 measured by grep, confirmed by reading each site. LSP is not used for counts on this repo —
it returned 2 references for `parseFrontmatter` where grep found 12.

- `writeIfNotDry` — 22 call sites: `utils.ts:278,329,364`; `claude.ts:222,242,307,314`;
  `opencode.ts:270,294,362`; `cursor.ts:119,136,156`; `windsurf.ts:96,125`;
  `copilot.ts:160,176,199,220,241`; `codex.ts:83`.
- **Invariant confirmed:** `fs.writeFileSync` appears exactly once in `src/`, at `utils.ts:209`
  inside `writeIfNotDry`. No converter writes directly, so conflict detection has a single
  enforcement point and cannot be bypassed.
- `slugify` — 14 call sites; the ones that can collide into a single output path are
  `utils.ts:271` (skills, shared by all six converters), `copilot.ts:167` (rule fallback name),
  and `opencode.ts:311` (`inferFormatterName`).
- `Converter.export` — implemented by all six converters, called at `index.ts:95`.

Do-not-touch boundaries:

- Emitted file paths, directory layout, and file contents stay as they are. This change alters
  whether a write happens, not what would be written.
- The permission and fidelity model from `fidelity-core` is settled; this change adds items to it
  rather than changing its shape.
- `tests/fixtures/sample-project/` keeps its current shape.

## Impact

**On-disk format.** Unchanged. No file path, name, or content changes for a conversion into a clean
directory. `<file>.bak` files are new, and only appear under `--force`.

**Behaviour change with real consequences.** A conversion into a directory holding differing config
now refuses and exits 2 where it previously overwrote and exited 0. This is the point of the change,
but it will fail runs that previously "succeeded" by destroying data. `--force` restores the old
behaviour, with a backup.

**Security posture.** Not weakened. This change only prevents destruction; it adds no path by which
a permission is written more permissively.

**CLI surface.** `convert` gains `--force`. Exit 2 becomes reachable for write conflicts as well as
blocked permissions — both mean "refused to proceed", which is consistent.

**API.** `Converter.export`'s third parameter changes from `dryRun?: boolean` to an options object.
Breaking for library consumers; the package ships a `bin` and no `exports` map, so CLI use is the
documented path. Bundled into the unreleased 0.2.0.

**Dependencies.** None added or removed. `zod` is revisited here: `readJsonIfExists` gaining real
error handling is the one place runtime validation earns its keep, so zod either gets used at that
boundary or is removed. Decided in design.

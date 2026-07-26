## 1. BDD barrier and interface changes (land first)

- [x] 1.1 Generate and run the BDD barrier before any code task:
      `uv run --no-project --script ~/.claude/tools/openspec-bdd.py generate --change safe-writes`,
      commit the generated `.feature` files, run vitest, and record the result. Every new ADDED
      scenario must be red; the 62 existing tests must stay green. Implementation is blocked until
      that split is observed.
- [x] 1.2 `src/utils.ts`: add `WriteContext` — `{ dryRun, force, items, written }` — and a
      `newWriteContext(options)` constructor.
- [x] 1.3 `src/utils.ts`: `writeIfNotDry` takes a `WriteContext` in place of `dryRun` and returns
      `boolean`. Missing file writes. Identical content is a no-op returning `true`. Differing
      content without `force` pushes a `blocked` item and returns `false`. Differing content with
      `force` copies to `<path>.bak`, writes, and pushes a `lossy` item naming the backup.
      Dry-run performs the same comparison and reporting but touches no file.
- [x] 1.4 `src/converters/types.ts`: `Converter.export` takes `options?: ExportOptions`
      (`{ dryRun?, force? }`) in place of `dryRun?: boolean`.
- [x] 1.5 Regression test: writing into an empty directory still writes every file, and the
      returned `filesWritten` is unchanged from `fidelity-core`.

## 2. Shared helpers (before their callers)

- [x] 2.1 `src/utils.ts`: add `uniqueSlugs(names)` returning one distinct slug per input, preserving
      order, disambiguating collisions deterministically.
- [x] 2.2 `src/utils.ts`: `exportSkillsToDir` uses `uniqueSlugs`, emitting a `lossy` item per
      disambiguation. This one site covers all six converters.
- [x] 2.3 `src/utils.ts`: `readFileIfExists` and `readJsonIfExists` distinguish `ENOENT` from parse
      and permission errors; the latter surface as `blocked` import items.
- [x] 2.4 Regression test for 2.1–2.2: `Testing`/`testing` and `code review`/`code-review` each
      produce two files with both bodies present.

## 3. Converters (sequential, one reviewable unit each)

- [x] 3.1 `src/converters/claude.ts`: thread `WriteContext`; guard each `files.push` on the
      `writeIfNotDry` result.
- [x] 3.2 `src/converters/opencode.ts`: same threading. Then fix `inferFormatterName` so `black`,
      `isort`, `autopep8`, and `yapf` keep their own names instead of all becoming `ruff`, and
      `buildFormatterConfig` no longer collapses two formatters into one key.
- [x] 3.3 `src/converters/cursor.ts`: same threading.
- [x] 3.4 `src/converters/windsurf.ts`: same threading.
- [x] 3.5 `src/converters/copilot.ts`: same threading. Then fix `exportRules` so rules lacking a
      `source` do not all collide onto `rule.instructions.md`.
- [x] 3.6 `src/converters/codex.ts`: same threading.
- [x] 3.7 Regression test across 3.1–3.6: for each of the six targets, converting into an empty
      directory produces byte-identical output to `fidelity-core`.

## 4. CLI surface

- [x] 4.1 `src/index.ts`: add `--force`, pass `{ dryRun, force }` to `export`.
- [x] 4.2 `src/index.ts`: seed the export context's items from the imported config so import-side
      blocked items (malformed input) reach the report and the exit code.
- [x] 4.3 Regression test: exit 2 on write conflict, exit 0 with `--force`, exit 0 into a clean
      directory.

## 5. Remove zod

- [x] 5.1 `src/schema.ts`: replace the zod schemas with plain TypeScript types of identical shape.
      Keep every exported type name so no importer changes.
- [x] 5.2 Remove `zod` from `package.json`. Confirm `npm ls zod` is empty and the runtime audit
      stays clean.
- [x] 5.3 Run `npm run check` and confirm the emitted output is unchanged.

## 6. Verification

- [x] 6.1 End-to-end: convert into a directory holding a differing file; assert the file is
      unchanged on disk and the run exits 2. Repeat with `--force`; assert `.bak` holds the original
      and the file holds the new content.
- [x] 6.2 End-to-end: convert twice into the same directory; assert the second run exits 0 and
      reports nothing blocked, proving idempotence.
- [x] 6.3 Diff emitted output against the `fidelity-core` build for all six targets into a clean
      directory; assert byte-identical.
- [x] 6.4 Update `CHANGELOG.md` under `[Unreleased]` and `README.md` for `--force` and the new exit
      condition.

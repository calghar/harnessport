## 1. BDD barrier

- [x] 1.1 Run `uv run --no-project --script ~/.claude/tools/openspec-bdd.py generate --change model-log-wrapper --change repair-cursor-conversion`, add the generated `features/cursor-model-log.feature` to the `bdd` script in `package.json`, run `npm run bdd`, and confirm every `cursor-model-log` scenario is RED except "Export without the flag matches the previous output", which must be GREEN. Record the counts here.
  - Recorded 2026-11-11: 12 scenarios, 52 steps, all undefined (no step definitions yet), so none GREEN, including the byte-identical scenario. The generator also deleted 21 committed feature files; they were restored from HEAD with `git show`, leaving no diff.

## 2. Interface

- [x] 2.1 Add `logModel?: boolean` to `ExportOptions` in `src/converters/types.ts`.
- [x] 2.2 Add `--log-model` to `convert` in `src/index.ts`; exit 1 with an error naming the flag when `--to` is not `cursor`, before import; pass `logModel` to `export`.
- [x] 2.3 Regression: run `npm run typecheck` and the existing `tests/convert.test.ts`; both pass unchanged.

## 3. Cursor export

- [x] 3.1 Add `modelLogSource()` beside `mcpAskSource` in `src/converters/cursor.ts`, following design.md Decision 8.
- [x] 3.2 In `exportHooks`, when `ctx`/options carry `logModel`, write `.cursor/hooks/harnessport-model-log.mjs`, append its entry to `eventEntries.stop` after relayed `Stop` entries, and include `logModel` in the `written === 0` early-return check. Push a `model-log` item with status `exact`.
- [x] 3.3 Regression: run `tests/cursor-wrapper.test.ts`, `tests/hooks.test.ts`, `tests/cursor-repair.test.ts` and `tests/safe-writes.test.ts`; all pass with no snapshot change.

## 4. Cursor import

- [x] 4.1 Extend `generatedWrapperMetadata` to accept `"MODEL_LOG"`; in `importHooks`, check it before the `HOOK` branch and push the `dropped` item with the reason fixed in the spec.
- [x] 4.2 Regression: run `tests/import-robustness.test.ts` and `tests/verify-check.test.ts`; both pass.

## 5. Tests and steps

- [x] 5.1 Add step definitions for the `cursor-model-log` scenarios under `features/step_definitions/`, running the generated wrapper with `node` against temporary directories.
- [x] 5.2 Add one test to `tests/cursor-wrapper.test.ts` that runs the wrapper with a stop payload and parses the appended line.
- [x] 5.3 Run `npm run check`; every `cursor-model-log` scenario is GREEN and every earlier scenario stays GREEN.

## 6. Docs

- [x] 6.1 Add one bullet under `## [Unreleased]` in `CHANGELOG.md`: "Added `--log-model`, which records the Cursor main-agent model once per finished task in `.cursor/harnessport-model.jsonl`".
- [x] 6.2 Add one line to the Cursor hooks section of `README.md` naming `--log-model`, the log path, and that the log belongs in `.gitignore`. Run `npm run docs:check`.

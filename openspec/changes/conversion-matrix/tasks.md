## 1. BDD barrier (land first)

- [x] 1.1 Generate and run the BDD barrier before any code task:
      `uv run --no-project --script ~/.claude/tools/openspec-bdd.py generate --change conversion-matrix`,
      commit the generated `.feature` files, run vitest, and record the result. Every new ADDED
      scenario must be red; the 184 existing tests must stay green.

## 2. Fixtures (inputs before assertions)

- [x] 2.1 Add a source fixture per harness: `opencode-project`, `cursor-project`,
      `windsurf-project`, `copilot-project`, `codex-project`. Each holds rules and a skill, plus
      whatever else that harness natively carries.
- [x] 2.2 Assert each converter detects and imports its own fixture — at least one rule and one
      skill — so a fixture cannot silently rot.

## 3. Permission fidelity (shared enforcement point first)

- [x] 3.1 `src/converters/opencode.ts`: canonical permission tool names on import
      (`bash` → `Bash`, `webfetch` → `WebFetch`, `websearch` → `WebSearch`, …). Unmapped keys keep
      their own name.
- [x] 3.2 Regression per consumer of `PermissionEntry.tool`: assert the OpenCode exporter still
      emits the lowercase key `bash` (`buildPermissionConfig`), and that `permissionStatus` item
      names read `Bash(...)`.
- [x] 3.3 Regression for the Claude consumer: convert the `opencode-project` fixture to claude on
      real disk, read `.claude/settings.local.json` back, and assert `Bash(git push *)` under
      `ask` and `WebFetch` under `allow`.
- [x] 3.4 `src/converters/opencode.ts`: route a `WebSearch` permission through `permissionStatus`
      so it is `dropped` for `allow` and `blocked` for `ask`/`deny`, never `exact`.
- [x] 3.5 Test that a `WebSearch` deny bound for opencode exits `2`, and that `WebFetch` is
      unaffected and still `exact`.

## 4. Formatter fidelity

- [x] 4.1 `src/converters/claude.ts`: classify each formatter with
      `inferGlobFromCommand(f.command) === f.glob ? "exact" : "lossy"`, the reason naming the glob
      that will be seen instead.
- [x] 4.2 Regression: the emitted `.claude/settings.json` hook is byte-unchanged — only the
      reported status moves. Assert on the real file, not a dry-run path list.
- [x] 4.3 Test both directions: `*.py` + `ruff format` is `exact`; `*.ts` + `biome format --write`
      is `lossy` and re-imports as `*`.

## 5. The matrix

- [x] 5.1 `tests/matrix.test.ts`: all 30 ordered pairs, exporting to a real temp directory —
      assert the target's `detect` recognises the output.
- [x] 5.2 Assert rule text and skill names survive every pair.
- [x] 5.3 Assert re-running a conversion reports the same blocked set as the first run.
- [x] 5.4 Assert nothing is lost without a matching non-`exact` fidelity item, comparing by the
      same names the items use (`Tool(pattern)` for permissions, glob for formatters), with
      case-insensitive tool comparison.
- [x] 5.5 `tests/convert.test.ts`: delete the no-op `round-trip: claude -> opencode -> claude`
      block, now covered properly.

## 6. Type-checking the tests (M6)

- [x] 6.1 Rename `tsconfig.scripts.json` to `tsconfig.check.json` and add `tests` to its `include`;
      update the `typecheck` script.
- [x] 6.2 Replace `__dirname` in every test file with `fileURLToPath(import.meta.url)`, which works
      on Node 18 where `import.meta.dirname` does not.
- [x] 6.3 Fix whatever type errors type-checking the tests surfaces.

## 7. Verification

- [x] 7.1 Run `npm run check` (typecheck + lint + test + docs:check).
- [x] 7.2 Real CLI run: `npm run build`, then convert `opencode-project` to claude on disk and read
      `.claude/settings.local.json` by hand to confirm the permission entries are matchable.
- [x] 7.3 Confirm the `capabilities` consistency test still passes — `claude.formatter` and
      `opencode.permission` must remain `full`.
- [x] 7.4 Update `CHANGELOG.md` under `[Unreleased]`: the permission tool-name fix and its re-run
      guidance, the `WebSearch` status fix and its new exit `2`, and the formatter glob fix.

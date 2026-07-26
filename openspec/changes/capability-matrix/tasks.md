## 1. BDD barrier (land first)

- [x] 1.1 Generate and run the BDD barrier before any code task:
      `uv run --no-project --script ~/.claude/tools/openspec-bdd.py generate --change capability-matrix`,
      commit the generated `.feature` files, run vitest, and record the result. Every new ADDED
      scenario must be red; the 108 existing tests must stay green.

## 2. Declarations (interface before callers)

- [x] 2.1 `src/schema.ts`: extract the inline `FidelityItem["kind"]` union into an exported
      `Feature` type and have `FidelityItem.kind` reference it. No member changes.
- [x] 2.2 `src/converters/types.ts`: add `Capability = "full" | "user-level" | "none"` and a
      required `capabilities: Record<Feature, Capability>` on `Converter`. Document that this is
      documentation of what converts, and that permission enforcement stays in `permissionStatus`.
- [x] 2.3 Regression: `npm run typecheck` fails until all six converters declare, confirming the
      record is total by construction rather than by convention.
- [x] 2.4 Declare `capabilities` on each converter, one per unit, reading its own `import`/`export`
      to fix the value: `claude.ts`, `opencode.ts`, `cursor.ts`, `windsurf.ts`, `copilot.ts`,
      `codex.ts`.

## 3. The behaviour the declaration describes

- [x] 3.1 `src/converters/opencode.ts`: report a `Hook` as `dropped`, not `lossy` — the exporter
      writes no representation of one. Reason text unchanged.
- [x] 3.2 Regression test for 3.1's caller path: export a config holding a hook and a formatter to
      a real temp directory, read `opencode.json` back, and assert the `formatter` key is present
      and unchanged while the hook item is `dropped`. Assert the run still exits `0`.
- [x] 3.3 Consistency test over all 6 converters × 8 features: export a config holding one of every
      feature to a real temp directory; assert `full` yields at least one `exact`/`lossy` item of
      that kind, and `user-level`/`none` yields no `exact` or `lossy` item.
- [x] 3.4 Test that a `user-level` declaration's drop reason names the out-of-repo path
      (`~/.codeium/windsurf/mcp_config.json`, `~/.codex/config.toml`).

## 4. Rendering

- [x] 4.1 `src/matrix.ts`: render the declaration as the CLI table (`✓` / `~` / `-` with legend)
      and as the README markdown table (`yes` / `user-level` / `-` with legend). One feature-label
      map shared by both.
- [x] 4.2 `src/index.ts`: replace the 24 hardcoded `console.log` lines in `list` with a render
      call. Assert the corrected cells appear.
- [x] 4.3 `scripts/sync-readme.ts`: rewrite the region between `<!-- BEGIN:matrix -->` and
      `<!-- END:matrix -->`; with `--check`, exit non-zero on drift and name `npm run docs:matrix`.
- [x] 4.4 `package.json`: add `docs:matrix` and `docs:check`; add `docs:check` to `check`.
- [x] 4.5 Regeneration step for the generated file: run `npm run docs:matrix` to insert the markers
      and the current table into `README.md`, then confirm a second run leaves the file unchanged.
- [x] 4.6 Test the drift check both ways: a generated README passes; a hand-edited region fails
      with a message naming `npm run docs:matrix`.

## 5. Verification

- [x] 5.1 Regression across all six converters. **Deviation from the written task:** no pre-change
      binary exists to diff against — phases 0-3 are uncommitted, so a rebuilt baseline would be
      the 0.1.2 release, whose output differs from this branch for reasons already landed. The
      claim is established instead by (a) `grep -rn "capabilities\|\.label" src/`, which finds
      exactly two reads, both in `src/matrix.ts:69,75`, neither reachable from any `export()`;
      (b) the 108 pre-existing tests, including `safe-writes`' emitted-content assertions,
      unchanged and green; (c) the six target trees emitted from the built CLI over
      `sample-project` and hashed. The only semantic edit is a `FidelityItem.status` string, which
      is reported, never written to a file.
- [x] 5.2 Run `npm run check` (typecheck + lint + test + docs:check).
- [x] 5.3 Real CLI run: `npm run build`, then `node dist/index.js list` read by hand against the
      README table, and `node dist/index.js convert --from claude --to opencode --source <copy of
      tests/fixtures/sample-project> --target <tmp>` with the emitted files read back.
- [x] 5.4 Update `CHANGELOG.md` under `[Unreleased]`: the corrected `list` cells, the README
      legend change, and the OpenCode hook status fix.

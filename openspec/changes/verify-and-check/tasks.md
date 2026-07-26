## 1. BDD barrier (land first)

- [x] 1.1 Generate and run the BDD barrier before any code task:
      `uv run --no-project --script ~/.claude/tools/openspec-bdd.py generate --change verify-and-check`,
      commit the generated `.feature` files, run vitest, and record the result. Every new ADDED
      scenario must be red; the 352 existing tests must stay green.

## 2. The shared comparison (extract before consuming)

- [x] 2.1 `src/compare.ts`: `inventory(config)` keyed as the fidelity report names things —
      `Tool(pattern)` for permissions, glob for formatters, `name` otherwise.
- [x] 2.2 `src/compare.ts`: `roundTripLoss(source, target, items)` returning `accounted` and
      `unaccounted`, with case-insensitive permission tool comparison and rule comparison by
      content containment.
- [x] 2.3 `src/compare.ts`: `divergences(configs)` for the pairwise `check` comparison, naming
      `presentIn` and `absentFrom`.
- [x] 2.4 Regression: `tests/matrix.test.ts` drops its private `inventory` and imports the shared
      one. All 30 pair assertions must stay green — that is the proof the extraction is faithful.

## 3. verify

- [x] 3.1 `src/index.ts`: `verify <dir> --from X --to Y [--json]`. Export into
      `fs.mkdtempSync`, re-import, report `accounted` and `unaccounted`.
- [x] 3.2 Exit `1` for an unknown harness name, identical from/to, or a directory the source
      converter does not detect. Exit `2` on unaccounted loss. Exit `0` otherwise.
- [x] 3.3 **Safety test:** hash every file under the inspected directory before and after, and
      assert the tree is unchanged. This is the one defect this command must never have.
- [x] 3.4 Test that all six fixtures verify with exit `0` against several targets — a lossy but
      honest conversion passes.
- [x] 3.5 Test that a conversion with unaccounted loss exits `2` and names the item, using a
      stubbed fidelity report so the case is reachable without reintroducing a defect.
- [x] 3.6 Test `--json`: stdout parses, carries `accounted` and `unaccounted`, human output on
      stderr.

## 4. check

- [x] 4.1 `src/index.ts`: `check <dir> [--json]`. Detect, import each, compare pairwise.
- [x] 4.2 Exit `1` when nothing is detected; `0` when fewer than two harnesses are found, saying
      so; `2` on divergence.
- [x] 4.3 **Safety test:** assert the inspected directory is unchanged.
- [x] 4.4 Test divergence is reported with direction — present in claude, absent from opencode —
      against a fixture holding both.
- [x] 4.5 Test that rules matching by content across `CLAUDE.md` and `AGENTS.md` are not reported
      as divergence.
- [x] 4.6 Test `--json`: `detected` carries both harness names.

## 5. Documentation and verification

- [x] 5.1 `README.md`: document both commands, their exit codes, and that both are read-only.
      Extend the exit-code table.
- [x] 5.2 Run `npm run check` (typecheck + lint + test + docs:check).
- [x] 5.3 Real CLI run against `tests/fixtures/`: `verify` on a fixture whose output is read by
      hand, and `check` on a directory holding two harnesses. Confirm exit codes with `echo $?`
      not piped through another command.
- [x] 5.4 Confirm `harnessport verify` on this repository leaves it clean — `git status` before
      and after.
- [x] 5.5 Update `CHANGELOG.md` under `[Unreleased]`.

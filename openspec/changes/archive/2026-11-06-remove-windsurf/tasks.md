## 1. BDD barrier

- [x] 1.1 Regenerate features with every in-flight change named: `uv run --no-project --script ~/.claude/tools/openspec-bdd.py generate --change remove-windsurf --change hook-fidelity --change capability-matrix --change claude-rule-scoping --change conversion-matrix --change fidelity-core --change safe-writes --change verify-and-check`.
- [x] 1.2 Run the cucumber barrier. Record in `tmp/remove-windsurf-barrier-cucumber.log`. The four `target-set` scenarios must be red. Preserved scenarios from the other changes must stay as they were.
- [x] 1.3 Run `npx vitest run` and record in `tmp/remove-windsurf-barrier-vitest.log`. Expected green, since nothing is removed yet.

## 2. Code and tests

- [x] 2.1 Delete `src/converters/windsurf.ts`.
- [x] 2.2 `src/matrix.ts`: remove the import (line 14) and the `ALL_CONVERTERS` entry (line 25).
- [x] 2.3 `src/utils.ts:574`, `src/schema.ts:13,108`: fix the comments that name Windsurf. Do not change logic.
- [x] 2.4 Remove Windsurf rows and cases from `tests/capabilities.test.ts`, `tests/fidelity.test.ts`, `tests/convert.test.ts`, `tests/matrix.test.ts`, `tests/verify-check.test.ts`. Delete the `windsurf-project` fixture entries and the fixture directory if nothing else references it.
- [x] 2.5 `tests/fidelity.test.ts:317-320`: replace the Windsurf exit-0 case with the exit-1 case from `specs/target-set/spec.md`.
- [x] 2.6 Add the four `target-set` scenarios as vitest cases in `tests/fidelity.test.ts` (CLI runs), so the spec has a test beside the cucumber scenarios.
- [x] 2.7 Run `npm run typecheck` and `npx vitest run`. Both exit `0`.

## 3. Docs and config

- [x] 3.1 `npm run docs:matrix`, then `npm run docs:check` exits `0`.
- [x] 3.2 `README.md:59,96,233` and the layout tree: remove Windsurf lines by hand. Keep the Windsurf column out of the matrix tables.
- [x] 3.3 `package.json:4` description and `package.json:39` keyword: remove `Windsurf` and `windsurf`.
- [x] 3.4 `openspec/config.yaml:17,24,45`: five harnesses, no Windsurf file in the layout.
- [x] 3.5 `CHANGELOG.md` `[Unreleased]` `### Removed`: Windsurf target removed, `--to windsurf` and `--from windsurf` exit `1`.

## 4. Open changes

- [x] 4.1 For each of `capability-matrix`, `conversion-matrix`, `fidelity-core`, `safe-writes`, `verify-and-check`, `claude-rule-scoping`, `hook-fidelity`: remove Windsurf rows, requirements and tasks. Remove a requirement only when it tests Windsurf alone.
- [x] 4.2 `openspec validate --all --strict` exits `0`.
- [x] 4.3 `grep -ril windsurf openspec/changes features src tests README.md package.json` lists only this change's own files and `CHANGELOG.md`.

## 5. Regenerate and gate

- [x] 5.1 Regenerate features with every in-flight change named (same command as 1.1).
- [x] 5.2 Run the cucumber run. Every `target-set` scenario is green. Record in `tmp/remove-windsurf-cucumber.log`.
- [x] 5.3 `npm run check` exits `0`. Record in `tmp/remove-windsurf-check.log`.
- [x] 5.4 Real CLI run on a temp copy of `tests/fixtures/sample-project`: `npm run dev -- convert --from claude --to windsurf ...` exits `1`; `--to cursor` exits `0`.

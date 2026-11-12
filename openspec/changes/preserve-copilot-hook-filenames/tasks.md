## 1. Executable Contract

- [x] 1.1 Generate BDD scenarios for `preserve-copilot-hook-filenames` together with every active change that has valid spec artifacts; stop if generation would delete unrelated legacy features.
- [x] 1.2 Run the new Copilot filename scenarios before source changes and confirm they fail for the missing behavior.
- [x] 1.3 Add step definitions for purpose-named files, grouped entries, fallback output, and refused overwrites.

## 2. Canonical Provenance

- [x] 2.1 Add optional Copilot source-file provenance to `Hook` and keep it outside cross-target semantic comparison.
- [x] 2.2 Add unit coverage proving provenance differences do not create cross-target runtime-fidelity failures.

## 3. Copilot Import and Export

- [x] 3.1 Record each imported hook entry's `.github/hooks/*.json` basename.
- [x] 3.2 Bucket exported hook entries by validated retained basename and write each bucket with the documented `version: 1` wrapper.
- [x] 3.3 Export entries without valid retained provenance to `.github/hooks/hooks.json`.
- [x] 3.4 Add unit tests for multiple source files, same-file grouping, accepted bare files, mixed named and unnamed hooks, and an existing conflicting target file.

## 4. Required Ripple

- [x] 4.1 Narrow the existing Copilot `hooks.json` BDD expectation to hooks without retained source-file provenance.
- [x] 4.2 Document Copilot hook filename preservation and fallback behavior in `README.md`.
- [x] 4.3 Add the user-visible fix under `CHANGELOG.md` `[Unreleased]`.

## 5. Verification

- [x] 5.1 Run the new BDD scenarios and targeted hook unit tests.
- [x] 5.2 Run `openspec validate preserve-copilot-hook-filenames --strict`.
- [x] 5.3 Delegate `npm run check` to a Grok 4.7 High gate runner in chunks under 10 minutes and verify its log `EXIT=` records.
- [x] 5.4 Run the post-edit propagation audit across hook callers, tests, README, comments, and changelog.

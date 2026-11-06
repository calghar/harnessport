## Why

Windsurf is no longer supported as a harnessport target. Its converter, tests, fixtures and docs must go, so the tool does not advertise or write a target it no longer maintains.

## What Changes

- **REMOVED** `src/converters/windsurf.ts` and its registration in `src/matrix.ts` (`ALL_CONVERTERS`).
- **REMOVED** Windsurf rows and cases from `tests/capabilities.test.ts`, `tests/fidelity.test.ts`, `tests/convert.test.ts`, `tests/matrix.test.ts`, `tests/verify-check.test.ts`, and the `windsurf-project` fixture entries.
- **MODIFIED** `convert --to windsurf` and `--from windsurf` **BREAKING**: exit `1` with `Unknown target` or `Unknown source` and the list of remaining targets (existing behaviour for unknown names).
- **MODIFIED** `list` and `detect` output omit Windsurf. **BREAKING** for scripts that parse them.
- **MODIFIED** README matrix, target list, and `src/` tree (regenerated with `npm run docs:matrix`, then hand-edited where it is prose).
- **MODIFIED** `package.json` description and keyword `windsurf`.
- **MODIFIED** `openspec/config.yaml` context (five harnesses, Windsurf removed from the layout and status lines).
- **MODIFIED** open changes that describe Windsurf: `capability-matrix`, `conversion-matrix`, `fidelity-core`, `safe-writes`, `verify-and-check`, `claude-rule-scoping`, `hook-fidelity`. Windsurf rows and text are removed from their proposal, design, spec and task files.
- **REMOVED** the Windsurf call site from the `hook-fidelity` P1 change (`src/converters/windsurf.ts` edit), because the file is deleted.
- **ADDED** `CHANGELOG.md` `[Unreleased]` entry under `### Removed`. Historical entries stay unchanged.
- **Unchanged:** harnessport never deletes files under a user's `.windsurf/` directory. Those files are the user's.

## Capabilities

### Modified Capabilities
- None. `openspec/specs/` holds no archived capability specs.

### New Capabilities
- `target-set`: the supported target and source list, and the CLI failure for a removed name.

## Blast radius

Grep-confirmed, repo root, 2026-11-06. Windsurf is not called from any other converter. The only code caller outside its own file is `src/matrix.ts:14,25`. Its helper use in `src/utils.ts:574` and `src/schema.ts:13,108` is comments only.

Code and tests:
- `src/converters/windsurf.ts` (whole file)
- `src/matrix.ts:14,25`
- `src/utils.ts:574` (comment)
- `src/schema.ts:13,108` (comments)
- `tests/capabilities.test.ts:10,26,84-86,123-125,160-162,194-195`
- `tests/fidelity.test.ts:10,32,157,199,237,260,275,317-320`
- `tests/convert.test.ts:7,107-111`
- `tests/matrix.test.ts:26`, `tests/verify-check.test.ts:24`

Docs and config:
- `README.md:12,59,96,209-216,233`
- `package.json:4,39`
- `openspec/config.yaml:17,24,45`
- `CHANGELOG.md` history: unchanged

Do not touch: `src/converters/{claude,opencode,cursor,copilot,codex}.ts` except where they name Windsurf in a comment. `permissionStatus` and every permission write path. `writeIfNotDry` callers.

## Impact

- **On-disk output:** no new or changed file for the five remaining targets. Windsurf output is no longer written.
- **CLI surface:** `--to windsurf` and `--from windsurf` exit `1`. The target list in `list` and in error text shrinks from six to five. This is BREAKING.
- **Dependencies:** none added or removed.
- **Security:** a removed target cannot weaken a permission. Removal also removes the Windsurf `blocked` hook path that P1 added.
- **Consumers:** any script that converts to Windsurf now fails. Release note required.

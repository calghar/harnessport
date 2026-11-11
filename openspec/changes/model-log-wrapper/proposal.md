## Why

Cursor's local store does not record which model ran the main agent for a task, so routing adherence cannot be measured. Cursor documents `model`, `model_id` and `model_params` as common fields in every hook payload (https://cursor.com/docs/hooks, checked 2026-11-11 by an earlier investigation), so a `stop` hook can record the model once per finished task.

This proposal describes harnessport at `6d857ff` on branch `fix-npm-release-propagation`, read on 2026-11-11.

## What Changes

- **ADDED** `convert` option `--log-model`. With `--to cursor`, the export writes a Cursor-only wrapper `.cursor/hooks/harnessport-model-log.mjs` and registers it under the Cursor `stop` event in `.cursor/hooks.json`.
- **ADDED** The wrapper appends one JSON line per finished task to `.cursor/harnessport-model.jsonl`. It never blocks the agent.
- **ADDED** `--log-model` with any target other than `cursor` exits 1 and writes nothing.
- **ADDED** The Cursor importer reports the model-log wrapper as `dropped`, since Claude Code has no equivalent hook.
- Without `--log-model`, every export stays byte-identical to the current output. No change is **BREAKING**.

## Non-goals

- Token usage logging. No Cursor hook payload carries token or cost fields; `preCompact` carries context size only. This change records no token use.
- `model_params` logging. The field is recorded nowhere downstream today; add it when a consumer needs it.
- A Claude Code model log. The wrapper template is Claude-contract only, and Claude hook payloads carry no model field [UNVERIFIED].
- Reading, rotating or summarising the log. The file is input for a separate analysis.
- Editing `.gitignore`.

## Capabilities

### New Capabilities

- `cursor-model-log`: the opt-in `stop` wrapper, its log record, its failure behaviour and its import handling.

### Modified Capabilities

None. `openspec/specs/` holds no capability folder in this checkout.

## Blast radius

Measured with grep and Read from the repository root on 2026-11-11. graphify and the TypeScript LSP were not run; every count below comes from grep and was confirmed by reading the matched lines.

| Surface | Measured | Effect of the change |
|---|---|---|
| `src/converters/cursor.ts` (1,056 lines) | `exportHooks` (1 caller: `cursorConverter.export`, line 1032), `importHooks`, `generatedWrapperMetadata` (2 call sites, lines 196 and 206), `mcpAskSource` (pattern to copy) | new `modelLogSource`, one `stop` entry, one import branch, early-return condition at the `written === 0` check |
| `src/converters/types.ts` | `ExportOptions` used by 6 `export` implementations | one optional field; the 5 non-Cursor converters ignore it |
| `src/index.ts` | `export(` call sites: line 107 (`convert`), line 215 (`verify`, passes `{}`) | one option and one target check on `convert`; `verify` unchanged |
| `tests/*.ts` | 56 `.export(` calls, 10 references to `harnessport-guard-` or `MCP_ASK` | none pass the new field, so all keep their current output |
| `features/` and `package.json` `bdd` script | 6 feature files listed explicitly in `bdd` | one generated feature file added to the list |
| `README.md`, `CHANGELOG.md` | Cursor hooks section (lines 123-138), `[Unreleased]` empty | one line each |

Files touched by implementation: 3 source, 1 test, 1 step-definition file, 1 generated feature, `package.json`, `README.md`, `CHANGELOG.md`.

Do-not-touch boundaries:
- `WRAPPER_TEMPLATE` and `wrapperSource`: the guard wrapper keeps its bytes.
- Guard numbering `harnessport-guard-<n>.mjs` and the stale-wrapper scan: the model-log wrapper uses its own name, so `n` does not shift.
- The `.cursor/hooks.json` entries for existing events keep their order.

## Impact

- New on-disk outputs, written only with `--log-model`: `.cursor/hooks/harnessport-model-log.mjs` and a `stop` entry in `.cursor/hooks.json`. At run time Cursor causes `.cursor/harnessport-model.jsonl` to grow by one line per finished task.
- No new dependency. The wrapper uses `node:fs` only.
- The log holds conversation and generation identifiers. It holds no prompt text.

## Process notes

- `openspec/schemas/brownfield/` holds no files in this checkout, so `openspec new change --schema brownfield` failed. The change was created with the default `spec-driven` schema. The artifact instructions were taken from the canonical brownfield schema (`~/.claude/openspec-schemas/brownfield/schema.yaml`, read only). Restoring the repo copy needs `/openspec-adopt`.
- `openspec/changes/repair-cursor-conversion/` holds empty directories only. Task 1.1 still names it in the BDD command.
- The grill-me gate was not run, because this change was authored without access to the user. Its questions are recorded below.

## Requirements-analysis findings

Stage 1 (refinement) on `specs/cursor-model-log/spec.md`:

| Req | Status | Finding |
|---|---|---|
| Opt-in export | REFINED | "registers the wrapper" did not name the user-level form; the scenario now names the absolute quoted path |
| Byte-identical default | REFINED | "unchanged output" was untestable; it now compares file sets and bytes against the export without the flag |
| One record per task | REFINED | absent payload fields were undefined; they are now omitted, and `timestamp` is always written |
| Never block | KEPT | — |
| Non-Cursor target | ADDED | completeness gap: `--log-model --to codex` had no defined behaviour |
| Import | ADDED | completeness gap: the importer would have called the wrapper "not a generated harnessport guard" |
| Coexistence with Claude `Stop` hooks | ADDED | consistency check between the new `stop` entry and relayed `Stop` wrappers |

Stage 2:
- No conflict found between the seven requirements.
- GAP-1: a later export without the flag leaves an earlier `harnessport-model-log.mjs` on disk, unreferenced. Recorded as Q6.
- Boundary scenario, ACCEPTED: two tasks finish at once. Each record is one `appendFileSync` call under 4 KiB. POSIX `O_APPEND` makes such writes atomic on a local file system; on a synced folder this is [UNVERIFIED].
- Boundary scenario, ACCEPTED: `--log-model --dry-run` lists the wrapper path and writes nothing, through the existing `writeIfNotDry`.

## Open questions

Decided 2026-11-11: A for Q1-Q6

Each question has a default, marked, so implementation is not blocked.

Q1. Log path and fields.
- A) Keep (default): `.cursor/harnessport-model.jsonl`, fields `timestamp`, `conversation_id`, `generation_id` (when present), `model`, `model_id`.
- B) Change to: also record `model_params`.

Q2. Flag name and location.
- A) Keep (default): CLI option `--log-model` on `convert`.
- B) Change to: a key in a harnessport config file.

Q3. Log directory not writable.
- A) Keep (default): the wrapper exits 0 and writes one line to stderr prefixed `harnessport-model-log:`.
- B) Change to: exit 0 and write nothing at all.

Q4. Git ignore.
- A) Keep (default): harnessport does not edit `.gitignore`; the README states that the log should be ignored.
- B) Change to: the export appends `.cursor/harnessport-model.jsonl` to `.gitignore`.

Q5. `--log-model` with a non-Cursor target.
- A) Keep (default): `convert` exits 1 with an error and writes no files.
- B) Change to: print a warning and run the export without the log.

Q6. Earlier model-log wrapper left on disk when the flag is omitted.
- A) Keep (default): the file stays, unreferenced by `hooks.json`.
- B) Change to: delete it under `--force`, as the stale-guard scan does for guards.

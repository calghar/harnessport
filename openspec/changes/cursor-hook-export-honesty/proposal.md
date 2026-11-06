## Why

When Cursor's `.cursor/hooks.json` write is refused, a PreToolUse guardrail must not be reported `exact` or `lossy`, because nothing was written. `cursor-permissions-formatters` recorded this as open question 3.

## What Changes

- **ADDED** A refused `.cursor/hooks.json` write turns every PreToolUse hook item to `blocked`, with a reason, and the CLI exits 2.
- **ADDED** Regression tests: refused write (blocked, exit 2) and successful write (status unchanged, exit 0), both through the CLI.
- No change to what is written when the write succeeds.
- **BREAKING:** none.

## Capabilities

### Modified Capabilities
- none (`openspec/specs/` holds only `target-set`).

### New Capabilities
- `cursor-hook-export-honesty`: fidelity status of Cursor PreToolUse items when `hooks.json` is refused.

## Blast radius

Measured with grep over `src/` and `tests/`:

- Direct: `exportHooks` in `src/converters/cursor.ts`, the refusal branch after the single `hooks.json` write.
- Callers: `cursorConverter.export` only. Tests reading Cursor hook items: `tests/cursor-wrapper.test.ts`, `tests/hooks.test.ts`, `tests/fidelity.test.ts`.
- Do not touch: `opencode.ts`, `copilot.ts`, `codex.ts`, `openspec/changes/hook-fidelity/**`, the wrapper template, `writeIfNotDry`.

## Impact

- **On-disk output:** none when the write succeeds.
- **CLI:** a refused `hooks.json` exits 2 through the existing blocked-item path.
- **Current code:** the branch already exists in `exportHooks` (same shape as the formatter D6 treatment). This change adds the missing spec requirement and the CLI-level test that pins it.

## Why

Cursor runs hooks from `.claude/settings.json` itself. A Read or Write guardrail ported to `.cursor/hooks.json` runs twice per call (live probe, cursor-agent 2026.11.05, same `tool_use_id`). Cursor also does not pass `offset` or `limit` of a Read to any hook.

## What Changes

- **MODIFIED**: a Claude `PreToolUse` hook whose matcher tokens all map to Cursor `Read` or `Write` gets no wrapper and no `.cursor/hooks.json` entry. Its item is `lossy`.
- **MODIFIED**: a hook whose matcher includes `Read`, wrapped or not, is `lossy` with a reason that Cursor drops `offset` and `limit`. A wrapped `Bash|Read` hook was `exact`.
- **MODIFIED**: edits the hook-fidelity scenario that asserted a wrapper for `Edit|Write`.
- Unchanged: hooks with a `Bash` token (the wrapper renames `Shell` to `Bash`), hooks with no matcher or `*`, the wrapper template.

## Capabilities

### Modified Capabilities
- `cursor-hook-wrapper` (unarchived, in `hook-fidelity`): the wrapper-per-hook requirement and one scenario.

### New Capabilities
- `cursor-native-hooks`: which hooks Cursor runs natively and how they are reported.

## Blast radius

- `exportHooks` and `mapMatcher` in `src/converters/cursor.ts`; one caller, `cursorConverter.export`.
- Tests: `tests/cursor-wrapper.test.ts` (two rows of the matcher table). Features: `cursor-hook-wrapper`, new `cursor-native-hooks`.
- Do not touch: the wrapper template, the `Shell` to `Bash` rename, other converters, non-hook export.

## Impact

Fewer files written for Read/Write guardrails. A Read or Write guardrail runs only if Cursor's Third-Party Imports setting is on. No new flag or environment variable.

## Why

The OpenCode converter states things the OpenCode docs contradict (verified 2026-11-06, `tmp/verify-opencode.md`): it drops `WebSearch` as keyless, treats `lsp` as granular, writes an invented `list` key, rewrites `domain:x` into a URL pattern `webfetch` cannot hold, claims OpenCode has no mechanism besides the formatter, and drops the documented formatter fields `disabled` and `environment` on import.

## What Changes

- **MODIFIED** Export: `WebSearch` is written as the `websearch` key. Allow, ask and deny with pattern `*` are `exact`.
- **MODIFIED** Export: a shorthand-only tool with pattern `*` is written with its real action, not always `allow`. **BREAKING**: a `deny`/`ask` on `*` for `webfetch`, `lsp` etc. was `blocked` and now writes. Several entries collapse to the strictest action.
- **MODIFIED** `lsp` is shorthand-only. `list` leaves the granular set. **BREAKING**: `lsp` is written as a string, not an object.
- **MODIFIED** `domain:x` patterns are not written. `allow` is `dropped`, `deny`/`ask` is `blocked`. Previously rewritten to `https://x/*` under `webfetch`.
- **MODIFIED** Hook reason text: names plugins and `tool.execute.before` as the OpenCode path. No plugin is generated. Status stays as set by `hook-fidelity`.
- **MODIFIED** Formatter import: `disabled: true` entries are skipped and reported `dropped`. `environment` is reported `lossy`.
- **REMOVED**: none.

Unverified, left as is: granularity of `glob`, `grep`, `task`, `skill` (treated granular); `websearch`, `todowrite`, `question`, `doom_loop` (treated shorthand-only); `multiedit` mapping; whether `tool.execute.before` can block a call; formatter event mapping; empty `extensions` behavior.

## Capabilities

### New Capabilities
- `opencode-permissions`: which OpenCode permission keys the exporter writes, in what form, and how unsupported entries are reported.

### Modified Capabilities
- None. `openspec/specs/` is empty. The open changes `conversion-matrix` and `capability-matrix` hold the superseded claims ("WebSearch dropped", "supports only formatters"); this change supersedes them.

## Blast radius

Grep-confirmed. `GRANULAR_PERMISSIONS`, `UNREPRESENTABLE_TOOLS`, `transformPermissionPattern`, `partitionPermissions`, `buildPermissionConfig`, `parseFormatters` are module-private to `src/converters/opencode.ts`; no other file references them. Only `opencodeConverter.import/export` is public.

- `src/converters/opencode.ts`: all code edits.
- `tests/opencode-permission-fidelity.test.ts`: new.
- Not touched: `src/utils.ts` `permissionStatus`/`hookStatus`, `cursor.ts`, `copilot.ts`, `codex.ts`, `claude.ts`.
- Overlap: `conversion-matrix/specs/permission-fidelity` and the generated `features/permission-fidelity.feature` still assert "WebSearch dropped/blocked". They have no step definitions or vitest mirror; regenerate after archive.
- Overlap: `hook-fidelity` owns the hook status; this change edits only the reason string.

## Impact

- **On-disk output**: `opencode.json` gains `websearch`; `lsp` changes shape; no `https://` keys under `webfetch`.
- **CLI**: `WebSearch` deny/ask and `*` deny/ask on shorthand tools no longer exit 2. `domain:` deny/ask still exits 2.
- **Security posture**: no entry is widened. A `deny`/`ask` is written as itself or `blocked`, never as `allow`; `domain:` allow is dropped rather than flattened to all URLs.

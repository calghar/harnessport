## Why

The Copilot exporter states three things Copilot's documentation contradicts (permissions absent, no permission-request hook, a failing hook cannot block) and writes project MCP to a path Copilot does not read.

## What Changes

- **MODIFIED** Permission fidelity reason: the capability stays `none` and permissions are still not written, but the reason names the user-level Copilot CLI files (`~/.copilot/permissions-config.json`, `~/.copilot/settings.json`) that harnessport never writes. A repository-committed permission file (`.github/copilot/settings.json`) is UNVERIFIED and not written.
- **MODIFIED** `PermissionRequest` hook reason: the CLI has a `permissionRequest` event that harnessport does not map; Copilot cloud has none. Status stays `blocked`.
- **MODIFIED** `failClosed` hook reasons: a `preToolUse` hook blocks on non-zero exit (exit 2 denies) but a timeout fails open, so the guardrail stays `blocked`; any other event runs fail-open, so the hook stays `lossy`.
- **MODIFIED** Project MCP path: `.copilot/mcp-config.json` becomes `.github/mcp.json`, for export, import and detection. **BREAKING** for on-disk output: Copilot MCP conversions write `.github/mcp.json`; a project still holding `.copilot/mcp-config.json` is no longer read.
- **NOT IN THIS CHANGE**: the `permission` capability value, the README matrix and its MCP path row (README is off-limits here), `.mcp.json` as a target (Claude's own file).

## Capabilities

### Modified Capabilities
- none (`openspec/specs/` holds only `target-set`)

### New Capabilities
- `copilot-permission-fidelity`: truthful Copilot permission, permission-request hook and fail-closed reasons, and the project MCP path.

## Blast radius

Measured with grep over `src/`, `tests/`, `features/`, `README.md`:

- Direct: `src/converters/copilot.ts` only.
- Tests touching Copilot output: `tests/hooks.test.ts`, `tests/fidelity.test.ts` (failClosed exits 2, unchanged), `tests/capabilities.test.ts`, `tests/matrix.test.ts` and `tests/verify-check.test.ts` (use `tests/fixtures/copilot-project`, which holds no MCP file).
- Stale, outside the boundary: `README.md:222` lists `.copilot/mcp-config.json`. `features/hook-guardrails.feature` stays valid because statuses are unchanged.
- Do not touch: `cursor.ts`, `opencode.ts`, `codex.ts`, `openspec/changes/hook-fidelity/**`, `src/utils.ts` (`permissionStatus` and `hookStatus` take the reason text as a parameter).

## Impact

- **On-disk:** Copilot MCP file moves to `.github/mcp.json`. No other emitted file changes.
- **CLI:** no flag or stdout-format change. Exit codes are unchanged: every status is unchanged, only reason text changes.
- **Security:** no permission is written, so none is widened. A `deny` or `ask` is still `blocked` and an `allow` still `dropped`. A guardrail that Copilot cannot enforce stays `blocked`.
- **Dependencies:** none.

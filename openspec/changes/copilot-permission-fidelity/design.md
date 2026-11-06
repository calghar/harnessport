## Requirements analysis

Run per `/requirements-analysis`. Stage 1: every scenario names inputs and a status or substring to observe (testable) and names no code (solution-free). Stage 2: no pair conflicts; a `failClosed` PreToolUse hook reaches the `blocked` branch before the `lossy` branch, and `blocked` outranks `lossy` in `hook-fidelity`. Gap found: `failClosed` on `UserPromptSubmit` and `PermissionRequest` returns earlier with their own reasons, so the `failClosed` guardrail requirement covers only `PreToolUse`. Stage 3 answers, taken from the evidence file because no user was available: keep `permission` at `none` (keep as-is); write `.github/mcp.json`, not `.mcp.json` (change).

## Decisions

- **D1 permission:** keep `permission: "none"`. `user-level` would change the generated README matrix, which is out of scope, and the CLI's `permissions-config.json` stores saved decisions, not authored rules. The reason passes to `permissionStatus` as its `limitation` argument. `.github/copilot/settings.json` is UNVERIFIED for allow and deny keys, so it is not written.
- **D2 hooks:** reasons only. Statuses are unchanged, so `hook-fidelity` scenarios and `tests/fidelity.test.ts` stay valid. A `failClosed` PreToolUse stays `blocked` because a timeout fails open, so fail-closed cannot be guaranteed.
- **D3 MCP path:** `.github/mcp.json`, because `.mcp.json` is Claude's own file and a Claude to Copilot run in one directory would clobber it. One constant serves export, import and detect.
- **Ponytail:** one constant, reason strings edited in place, no new module.

## UNVERIFIED (not stated as fact anywhere)

Repo-level allow and deny keys in `.github/copilot/settings.json`; Cloud permissions; Cloud and VS Code MCP locations.

## Why

`src/converters/codex.ts` claims Codex has no permission model, no hook timeout field, and (by implication) a settled hook shape. Verification against the openai/codex repo refutes the first two and leaves the third unverified (`tmp/verify-codex.md`). The Codex docs site was unreachable, so every kept claim cites repo evidence (config.schema.json, execpolicy README, hooks discovery.rs) or says UNVERIFIED.

## What Changes

- **MODIFIED** Permission reason: Codex has command `prefix_rule` rules (decision `allow`, `prompt`, `forbidden`) for shell commands only. harnessport writes none of them, because the rules file path and project scope are UNVERIFIED. Items stay `dropped` (allow) and `blocked` (ask, deny); the reason names `prefix_rule` and says the path is UNVERIFIED.
- **MODIFIED** Hook timeout: the command handler has a `timeout` field. harnessport writes it. Status is `lossy`, because the unit is UNVERIFIED (`timeout_sec` in discovery.rs suggests seconds).
- **MODIFIED** Fail-closed reason: kept as a limitation, marked UNVERIFIED.
- **KEPT** `.codex/hooks.json` location and the matcher-group shape, cited to the openai/codex source in a code comment.
- **NOT IN THIS CHANGE**: writing a Codex rules file, mapping `[permissions.<name>]` profiles, Codex hook matchers other than `Bash` (UNVERIFIED), the `permission` capability value (README matrix is generated; stays `none` = harnessport writes no permissions).

**BREAKING:** none. `codex` exports gain a `timeout` key in `.codex/hooks.json` for hooks that carry one. Exit codes are unchanged.

## Capabilities

### New Capabilities
- `codex-permission-fidelity`: truthful Codex permission and hook-timeout reporting.

### Modified Capabilities
- none (`openspec/specs/` holds only `target-set`)

## Blast radius

Measured with grep over `src/`, `tests/`:

- Direct: `src/converters/codex.ts`.
- Tests touching Codex output: `tests/hooks.test.ts` (Bash-only hooks), `tests/fidelity.test.ts` (Codex deny stays `blocked`), `tests/capabilities.test.ts` (declaration vs export; `everyFeature` has no timeout, so unaffected).
- Do not touch: `permissionStatus` in `src/utils.ts` (shared; only its `limitation` argument is supplied), other converters, README matrix.

## Impact

- **On-disk output (Codex target only):** `timeout` key on a command handler when the source hook has one.
- **Security:** no permission is written, so no deny can be narrowed or widened. A deny or ask stays `blocked` and exits `2`.
- **UNVERIFIED remaining:** rules file path and project scope, timeout unit, fail-closed and exit-code semantics, non-Bash matcher names, JSON `{hooks:{...}}` wrapper form, project trust gating.

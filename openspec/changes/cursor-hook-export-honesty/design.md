## Context

`exportHooks` pushes each PreToolUse item as `exact` or `lossy` before the single `hooks.json` write. `writeIfNotDry` returns false when a differing file exists and `--force` is off. Formatter items already switch to `blocked` on that refusal (`cursor-permissions-formatters` D6). Open question 3 of that change left the PreToolUse items for a follow-up.

Requirements gate (`/requirements-analysis`): both requirements are testable, solution-free and consistent. One gap, the `--force` write, is covered by the second requirement (the write succeeds, so status is unchanged). No clarification needed.

## Goals / Non-Goals

**Goals:** a refused write never leaves a PreToolUse item `exact` or `lossy`; the CLI exits 2.

**Non-Goals:** the wrapper file (`harnessport-guard-N.mjs`) is still written before `hooks.json`, as today; blocked items for unmappable matchers and dialects; other converters.

## Decisions

**D1. Reuse the formatter pattern.** After the write, on refusal, every `kind: "hook"` item with status `exact` or `lossy` becomes `blocked` with `REASON_GUARD_REFUSED`. Alternative, deferring the pushes until after the write, was rejected: it reorders items and the stale-wrapper note depends on the pushed items.

**D2. Test through the CLI.** The exit code is set in `src/index.ts`, so the test runs `convert` with `tsx` against real temp directories.

## Risks / Trade-offs

- [Items already `blocked` for another reason are overwritten] → The branch matches only `exact` and `lossy`, so earlier reasons survive.
- [Success path regresses] → The second test pins `exact`, exit 0 and the written `preToolUse` entry.
- [Orphan wrapper after a refusal] → Kept as today; out of scope.

## Migration Plan

None. No on-disk format changes. Rollback: revert the test file.

## Open Questions

None.

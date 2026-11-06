## Requirements analysis (gate before design)

All five requirements pass Testable (each scenario names input, status, reason substring), Solution-free, Unambiguous. No two conflict: permission and hook paths are disjoint. Completeness: a hook with both `timeout` and `failClosed` is covered by the fail-closed requirement (not written, so no timeout item). Findings and choices:

- F1 `permission` capability value. A: keep `none` (matrix unchanged, README generated). B: change to `user-level`. Chosen A: harnessport writes nothing, and the capability test requires `none` or `user-level` to emit no written items; README cannot move in this change.
- F2 Write a rules file. A: write `.codex/rules/*.rules` as lossy. B: write nothing. Chosen B: path and project scope are UNVERIFIED, so a written deny could be silently unenforced.
- F3 Timeout status. A: `exact`. B: `lossy`. Chosen B: unit UNVERIFIED.

## Decisions

- D1 Permission reason: pass a `limitation` string to the existing `permissionStatus`; no change to `utils.ts`. `permissionActions` stays `NO_PERMISSIONS`, which now means "harnessport writes none", not "Codex has none".
- D2 Timeout: add optional `timeout` to the handler object when `hook.timeout !== undefined`. Reuse the existing `lossy` item shape.
- D3 Fail-closed: edit the reason string only.
- D4 Future mapping, recorded not built: allow→`allow`, ask→`prompt`, deny→`forbidden`, `Bash` tool only (E). Needs the rules path verified first.

Ponytail: no new helper or file; three string edits and one object spread.

## Regression guards

`tests/hooks.test.ts` Bash-only test and `tests/fidelity.test.ts` Codex deny `blocked` must pass unchanged. `tests/capabilities.test.ts` must pass unchanged (`timeout` absent in `everyFeature`).

## Rollback

Revert `src/converters/codex.ts` and the new test file. No migration: output differs only by the added `timeout` key.

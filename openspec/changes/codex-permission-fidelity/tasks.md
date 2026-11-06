## 1. Barrier

- [x] 1.1 Add `tests/codex-permission-fidelity.test.ts` covering every scenario in the spec; run it. The permission, timeout, and fail-closed scenarios are red; the shape and no-timeout scenarios pass. Log in `tmp/t4-red.log`.

## 2. Implementation

- [x] 2.1 In `src/converters/codex.ts`, pass a `prefix_rule`/UNVERIFIED limitation to `permissionStatus`; rewrite the capability comment.
- [x] 2.2 Write `timeout` on the handler; change the lossy reason to say the unit is UNVERIFIED.
- [x] 2.3 Mark the fail-closed reason UNVERIFIED; cite the openai/codex source for the hooks file and shape.
- [x] 2.4 Regression: `tests/hooks.test.ts`, `tests/fidelity.test.ts`, `tests/capabilities.test.ts` pass unchanged.

## 3. Verify

- [x] 3.1 `openspec validate codex-permission-fidelity --strict` exits 0; typecheck exits 0.

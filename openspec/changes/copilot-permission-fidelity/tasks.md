## 1. Barrier

- [x] 1.1 Add `tests/copilot-permission-fidelity.test.ts` covering every scenario; run it and record the red result in `tmp/t3-vitest-red.log`.

## 2. Implementation

- [x] 2.1 In `src/converters/copilot.ts`, pass the user-level reason to `permissionStatus`.
- [x] 2.2 Correct the `PermissionRequest` and `failClosed` reasons.
- [x] 2.3 Replace `.copilot/mcp-config.json` with a `.github/mcp.json` constant in export, import and detect.

## 3. Verify

- [x] 3.1 Targeted tests pass (`tmp/t3-vitest.log`); typecheck passes (`tmp/t3-typecheck.log`); `openspec validate copilot-permission-fidelity --strict` exits 0.
- [x] 3.2 Regression: `tests/hooks.test.ts`, `tests/fidelity.test.ts`, `tests/capabilities.test.ts` pass unchanged.

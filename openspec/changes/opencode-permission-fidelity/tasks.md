## 1. Red barrier

- [x] 1.1 Add `tests/opencode-permission-fidelity.test.ts` covering each scenario; run `npx vitest run tests/opencode-permission-fidelity.test.ts`; record the failing run in `tmp/t2-vitest-red.log`.

## 2. Implementation

- [x] 2.1 `src/converters/opencode.ts`: delete `UNREPRESENTABLE_TOOLS`; remove `list` and `lsp` from `GRANULAR_PERMISSIONS`; delete `transformPermissionPattern`.
- [x] 2.2 `partitionPermissions`: route `domain:` patterns to `permissionStatus`; write shorthand-only `*` entries of any action.
- [x] 2.3 `buildPermissionConfig`: shorthand-only keys take the strictest action.
- [x] 2.4 Correct the hook reason and the capability comment.
- [x] 2.5 `parseFormatters`: skip `disabled`, report `environment`; surface items from import.

## 3. Verify

- [x] 3.1 `npx vitest run` on the touched test files exits 0 (`tmp/t2-vitest.log`).
- [x] 3.2 `npx tsc --noEmit` exits 0 (`tmp/t2-typecheck.log`).
- [x] 3.3 `openspec validate opencode-permission-fidelity --strict` exits 0.

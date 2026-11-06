## 1. Regression tests (land first)

- [x] 1.1 Add `Cursor hook export honesty` tests in `tests/cursor-wrapper.test.ts`; with the refusal branch disabled the refused-write test fails and the success test passes (`tmp/t5-vitest-before.log`).
- [x] 1.2 Success-path test proves `exact`, exit 0 and one `preToolUse` entry.

## 2. Caller

- [x] 2.1 `exportHooks` refusal branch turns `exact`/`lossy` hook items to `blocked` (present in `src/converters/cursor.ts`; no source edit needed).
- [x] 2.2 Refused-write test proves `blocked`, a reason, unchanged file and exit 2.

## 3. Verification

- [x] 3.1 Targeted tests and typecheck pass (`tmp/t5-vitest.log`, `tmp/t5-typecheck.log`).

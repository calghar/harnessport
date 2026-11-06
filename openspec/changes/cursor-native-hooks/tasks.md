## 1. Barrier

- [ ] 1.1 Generate features for all changes, run cucumber on the Cursor features; the new `cursor-native-hooks` scenarios for `Read|Write` and `Bash|Read` fail, the Bash and no-matcher scenarios pass
- [ ] 1.2 Add unit tests for `Read|Write`, `Bash`, `Bash|Read` and no matcher; confirm the first and third fail before the change

## 2. Callers

- [ ] 2.1 Skip native hooks and add the `Read` reason in `src/converters/cursor.ts`
- [ ] 2.2 Update the two rows of the matcher table in `tests/cursor-wrapper.test.ts`

## 3. Follow-up

- [ ] 3.1 Update README hook paragraph and CHANGELOG `[Unreleased]`
- [ ] 3.2 Regenerate features with every change named; run typecheck and targeted vitest

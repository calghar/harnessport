## 1. BDD barrier and interface changes (land first)

- [x] 1.1 Generate and run the BDD barrier before any code task:
      `uv run --no-project --script ~/.claude/tools/openspec-bdd.py generate --change fidelity-core`,
      commit the generated `.feature` files, run vitest, and record the result. Every new ADDED
      scenario must be red; nothing may be green by accident. Implementation is blocked until that
      is observed.
- [x] 1.2 `src/schema.ts`: add `action: z.enum(["allow","ask","deny"]).default("allow")` to
      `PermissionEntrySchema`. Add `FidelityItemSchema` — `phase`, `kind`, `name`, `status`,
      optional `reason` — and export the inferred `FidelityItem` type.
- [x] 1.3 `src/schema.ts`: replace `warnings: z.array(z.string())` on `HarnessConfigSchema` with
      `items: z.array(FidelityItemSchema).default([])`.
- [x] 1.4 `src/converters/types.ts`: replace `warnings: string[]` on `ExportResult` with
      `items: FidelityItem[]`. Add a per-converter declaration of which permission actions it can
      represent, scoped to permissions only — the full capability matrix is Phase 4.
- [x] 1.5 Regression test: a `PermissionEntry` constructed without an `action` still parses and
      defaults to `allow`, so every existing construction site stays valid.

## 2. Shared helpers (before their callers)

- [x] 2.1 `src/utils.ts`: rename `generateDropWarnings` to `generateDropItems`, returning
      `FidelityItem[]` instead of `string[]`. Signature otherwise unchanged.
- [x] 2.2 `src/utils.ts`: add the helper that decides an outgoing permission's status from the
      entry's action and the target's declared capability — `exact` when representable, `blocked`
      when the action is `deny` or `ask` and it is not. This is the single place the
      never-weaken rule is enforced; no converter reimplements it.
- [x] 2.3 Regression test for 2.2 covering the target matrix in the `permission-fidelity` spec:
      claude and opencode `exact`; cursor, windsurf, copilot, codex `blocked`.

## 3. Converters (sequential, one reviewable unit each)

- [x] 3.1 `src/converters/claude.ts` import: read `permissions.allow`, `.deny`, and `.ask` from both
      `.claude/settings.json` and `.claude/settings.local.json`, setting `action` per key.
- [x] 3.2 `src/converters/claude.ts` export: write each entry to its matching key in
      `.claude/settings.local.json`. Emit items for what it writes.
- [x] 3.3 Regression test for 3.1–3.2: an `allow`-only claude config still emits a byte-identical
      `settings.local.json`, so users without deny rules see no output change.
- [x] 3.4 `src/converters/opencode.ts` import: preserve the action value in `parsePermissions`
      instead of discarding it via `Object.keys`.
- [x] 3.5 `src/converters/opencode.ts` export: replace the hardcoded `action: "allow"` at
      `buildPermissionConfig` with the entry's own action. A shorthand-only tool holding a `deny`
      emits a `blocked` item rather than collapsing to `allow`.
- [x] 3.6 Regression test for 3.4–3.5: a granular tool keeps its per-pattern `deny`; a
      shorthand-only tool holding a `deny` is refused and `opencode.json` does not grant it `allow`.
- [x] 3.7 `src/converters/cursor.ts`: return items via `generateDropItems`; permissions with a
      non-allow action become `blocked`. Assert emitted files are unchanged.
- [x] 3.8 `src/converters/windsurf.ts`: same as 3.7.
- [x] 3.9 `src/converters/copilot.ts`: same as 3.7.
- [x] 3.10 `src/converters/codex.ts`: same as 3.7, and move the import-side warning at
       `codex.ts:94` onto an item with phase `import`.
- [x] 3.11 Regression test across 3.7–3.10: for each of the four targets, emitted file paths and
       contents are identical to those produced before this change for a config with no deny rules.

## 4. CLI surface

- [x] 4.1 `src/index.ts`: render the grouped fidelity summary from items, replacing the flat
      `⚠` warning list.
- [x] 4.2 `src/index.ts`: add `--json`, writing the item list to stdout and the human summary to
      stderr so stdout parses cleanly. Works under `--dry-run`.
- [x] 4.3 `src/index.ts`: exit `2` when any item is `blocked`; `0` otherwise. Leave the existing
      exit `1` paths — unknown harness, identical source and target, absent source config —
      untouched.
- [x] 4.4 `src/index.ts`: read `--version` from `package.json` instead of the hardcoded `0.1.0`.
- [x] 4.5 Regression test: the four existing exit-1 conditions still exit 1.

## 5. Fixtures and verification

- [x] 5.1 Add `tests/fixtures/opencode-deny/` — an `opencode.json` with a granular `deny` and a
      shorthand-only `deny`. Do not modify `tests/fixtures/sample-project/`; existing tests assert
      against its counts.
- [x] 5.2 Add `tests/fixtures/claude-deny/` — `.claude/settings.json` with a `deny` list and
      `.claude/settings.local.json` with an `allow` list, covering the both-files requirement.
- [x] 5.3 End-to-end test writing to a real temp directory via `fs.mkdtempSync`, not `dryRun: true`,
      asserting on file contents read back from disk. Dry-run assertions do not execute the
      serialization path.
- [x] 5.4 Update the four existing export tests that assert on `result.warnings` to assert on items.
- [x] 5.5 Run `npm run check`. Then a real CLI run: convert the deny fixture to cursor, read back
      the emitted files, and confirm the pattern appears in no allow list and the process exits 2.
- [x] 5.6 Update `CHANGELOG.md` under `[Unreleased]`, and `README.md` where it documents CLI flags
      and exit behaviour. Bump to 0.2.0.

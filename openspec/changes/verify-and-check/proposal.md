## Why

The fidelity report says what a conversion *claims* it lost. Nothing checks that claim against
what a conversion actually loses. Building that comparison as a test found three defects in one
run; exposing it as a command gives users the same instrument, and gives repositories holding
several harness configs a way to notice when those configs have drifted apart.

## What Changes

- **ADDED** `src/compare.ts`: a semantic inventory of a `HarnessConfig` — the named things it
  holds, keyed by feature and named exactly as fidelity items name them — plus the diff between
  two inventories. This is the comparison `tests/matrix.test.ts` already performs, lifted out of
  the test so the command and the test cannot disagree.
- **ADDED** `harnessport verify <dir> --from X --to Y`: converts into a temporary directory,
  re-imports, and reports what did not survive, splitting it into loss the fidelity report
  accounted for and loss it did not. Exits `2` on unaccounted loss. Writes nothing to `<dir>`.
- **ADDED** `harnessport check <dir>`: imports every harness configured in the directory and
  reports where their canonical configs disagree. Exits `2` on divergence. Read-only.
- **ADDED** `--json` on both, matching `convert`'s contract: machine-readable on stdout,
  human-readable on stderr.
- **MODIFIED** `tests/matrix.test.ts` uses `src/compare.ts` instead of its own private inventory
  helper.
- **MODIFIED** `README.md` documents both commands and their exit codes.

**No converter changes.** Both commands are readers.

## Capabilities

### Modified Capabilities

- `conversion-reporting`: the fidelity report gains a way to be checked rather than trusted.

### New Capabilities

- `round-trip-verification`: `verify` reports drift a conversion did not account for.
- `config-drift-check`: `check` reports disagreement between the harness configs in one
  repository.

## Blast radius

Established by grep over `src/` and `tests/`.

- `src/index.ts` — two new `program.command(...)` blocks. The existing `convert`, `detect`, and
  `list` actions are untouched; `CONVERTERS` is already imported from `src/matrix.ts`.
- `tests/matrix.test.ts:60-72` — its local `inventory` helper is replaced by the shared one. This
  is the only existing caller of the logic being extracted.
- No converter, and no file under `src/converters/`, is modified. `src/utils.ts` is not modified.

**Do-not-touch boundaries:**

- **`verify` must never write into the directory it is given.** It exports into a
  `fs.mkdtemp` directory and reads back from there. A verification command that modified the
  repository it was asked to inspect would be the worst possible defect in this tool.
- `check` opens no write path at all — it calls `detect` and `import` only.
- `permissionStatus` and `writeIfNotDry` are untouched; neither command adds a second place where
  a permission or a write is decided.
- Exit-code semantics stay as documented: `0` fine, `1` cannot run, `2` something the user must
  look at.

## Impact

- **APIs:** `src/compare.ts` is new and internal.
- **CLI surface:** two new commands, each with `--json`. No existing command, flag, or exit code
  changes.
- **Dependencies:** none.
- **On-disk formats:** none. `verify` writes only into a temporary directory it creates and does
  not clean up (the same convention the test suite uses, so a failed run can be inspected);
  `check` writes nothing.
- **Consumers:** additive. `harnessport check` is intended for CI, so its exit codes are the
  contract.
- **Permissions:** neither command writes a permission anywhere. `verify` reports a permission
  that failed to survive a round trip, which surfaces posture loss rather than causing it — the
  `bash`/`Bash` defect fixed in `conversion-matrix` is exactly what it would have caught.

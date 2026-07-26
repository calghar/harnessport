## Why

Of the twelve import/export paths, five importers are never invoked by a test and the one test
named `round-trip: claude -> opencode -> claude` performs no export and no re-import — it asserts
on the original config, so it cannot fail for any conversion defect. Building the missing 6×5
matrix immediately found three defects, each of which reports `exact` while losing or weakening
something.

## What Changes

- **ADDED** a source fixture per harness — `opencode-project`, `cursor-project`,
  `windsurf-project`, `copilot-project`, `codex-project` — so the five untested importers are
  exercised. `sample-project` remains the Claude fixture.
- **ADDED** `tests/matrix.test.ts`: all 30 ordered tool pairs, exporting to a real temp directory
  and re-importing, asserting that the target detects what was written, that rule content and
  skill names survive, that re-running is idempotent, and that every lost item is accounted for by
  a fidelity item.
- **MODIFIED** `src/converters/opencode.ts`: a `WebSearch` permission is reported `dropped` (or
  `blocked` for `ask`/`deny`) instead of `exact`. `buildPermissionConfig` filters `websearch` out
  of the emitted config, so it was reported fully converted while never being written.
- **MODIFIED** `src/converters/opencode.ts`: permission tool names import in canonical form
  (`bash` → `Bash`, `webfetch` → `WebFetch`). **This is a permission-posture fix** — see below.
- **MODIFIED** `src/converters/claude.ts`: a formatter is reported `lossy` when Claude Code's hook
  config cannot hold its glob, instead of `exact`. **This is a widening fix** — see below.
- **MODIFIED** `tests/convert.test.ts`: the no-op round-trip test is replaced by the matrix.
- **MODIFIED** `tsconfig.scripts.json` becomes `tsconfig.check.json`, covering `tests/` as well as
  `scripts/`, so test files are type-checked (**M6**). Test files replace `__dirname`, which only
  works because vitest transpiles it, with `fileURLToPath(import.meta.url)`.

## Capabilities

### Modified Capabilities

- `permission-fidelity`: two permissions that were reported `exact` are reported truthfully, and
  permission tool names are canonicalised so a converted rule still matches in the target.
- `conversion-reporting`: a formatter whose glob cannot be stored is reported `lossy`.

### New Capabilities

- `conversion-matrix`: every ordered pair of harnesses converts, is detected by its target, keeps
  the features both sides support, and accounts for everything it does not keep.

## Blast radius

Established by grep, and by running all 30 pairs against real fixtures before writing this.

- `src/converters/opencode.ts:117` `parsePermissions` — the only producer of lowercase permission
  tool names. Consumers of `PermissionEntry.tool`: `claude.ts:365` (`buildSettingsLocalJson`,
  renders `tool(pattern)` into `.claude/settings.local.json`), `opencode.ts:463`
  (`buildPermissionConfig`, lowercases on write, so it is unaffected by canonicalisation),
  `utils.ts:522` (`permissionStatus`, renders the item name only). Claude's own importer
  (`claude.ts:145`) already reads capitalised names from settings files, so it needs no change.
- `src/converters/claude.ts:494` — the `exactItems("formatter", …)` call becomes a per-formatter
  classification using the existing `inferGlobFromCommand` at `:186`.
- `tests/convert.test.ts:148-154` — the no-op round-trip block is removed.
- All six converters are exercised by the new matrix test but none other is modified.

**Do-not-touch boundaries:**

- `permissionStatus` (`src/utils.ts:517`) stays the single never-weaken enforcement point. The
  OpenCode `websearch` fix routes *through* it rather than adding a second decision site.
- Emitted file layout, frontmatter shape, and naming are unchanged. The one emitted-bytes change
  is the permission tool name inside `.claude/settings.local.json`, which is the defect being
  fixed.
- `capabilities` declarations are unchanged: `opencode.permission` and `claude.formatter` stay
  `full`, since both still produce `exact` or `lossy` items for representable inputs.

## Impact

- **APIs:** none. No interface changes.
- **CLI surface:** no flags or exit codes change. A conversion carrying a `WebSearch` deny or ask
  rule to OpenCode now exits `2` instead of `0`, which is the point — it was previously reported
  as converted and silently discarded.
- **Dependencies:** none.
- **On-disk formats:** `.claude/settings.local.json` written from an OpenCode source now carries
  `Bash(git push *)` where it previously carried `bash(git push *)`. The old form does not match
  any Claude Code tool, so this changes a non-functional entry into a functional one.
- **Consumers:** anyone who converted OpenCode permissions into Claude Code with 0.1.x or with the
  earlier phases of this branch has a settings file whose entries never matched. They should
  re-run the conversion.
- **Permissions — can this weaken a posture?** No; it closes two ways a posture was being weakened.
  (1) An OpenCode `bash: {"git push *": "ask"}` rule was written to Claude as `bash(git push *)`,
  which Claude Code does not match, so the `ask` never fired and the command ran unprompted. It now
  writes `Bash(git push *)`, which matches. (2) A `WebSearch` deny or ask rule bound for OpenCode
  was reported `exact` and dropped; it is now `blocked` and fails the run. Both are enforced
  through the existing `permissionStatus`.

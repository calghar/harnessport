## Why

`harnessport list` — the command whose entire purpose is telling a user what converts — reports
Cursor agents/skills/commands and Copilot agents/skills/commands/MCP/hooks as unavailable, while
those converters implement all of them. Three hand-maintained tables (the CLI's, the README's
support matrix, and the converters themselves) disagree, and nothing detects the drift.

## What Changes

- **ADDED** `Capability` type and a required `capabilities` field on the `Converter` interface
  (`src/converters/types.ts`). Each converter declares, per feature, whether harnessport converts
  it: `full`, `user-level`, or `none`.
- **ADDED** `src/matrix.ts`, which renders that data as the CLI table and as the README markdown
  table, so both come from one source.
- **ADDED** `scripts/sync-readme.ts`, run as `npm run docs:matrix` to regenerate and
  `npm run docs:check` to fail on drift. `npm run check` gains the drift check.
- **MODIFIED** `harnessport list` renders from `Converter.capabilities` instead of 24 hardcoded
  `console.log` lines. **Its output changes**: 8 cells that read `-` now read `✓` (Cursor agents,
  skills, commands; Copilot agents, skills, commands, MCP, hooks), and cells that claimed partial
  support for a feature harnessport does not convert at all now read `-` or `~` truthfully.
- **MODIFIED** `README.md`'s support matrix is generated, and its `partial` legend is replaced by
  `user-level`, which states the actual reason rather than a vague degree.
- **MODIFIED** `src/schema.ts` extracts the inline `FidelityItem["kind"]` union into a named
  `Feature` type. No value changes; `capabilities` is keyed by it so a new feature cannot be added
  to one and forgotten in the other.
- **MODIFIED** `src/converters/opencode.ts` reports an unconvertible hook as `dropped` rather than
  `lossy`. Nothing is written for it, and the new capability-consistency test makes the
  misclassification visible.

**Not breaking.** `capabilities` is additive on an interface only this repo implements; no emitted
file, CLI flag, or exit code changes. The `list` command's stdout changes, and it is documented as
human-readable — `--json` on `convert` remains the scripting surface.

## Capabilities

### Modified Capabilities

- `conversion-reporting`: the feature matrix becomes derived data rather than three hand-written
  tables, and one fidelity status in the OpenCode exporter is corrected to match what it does.

### New Capabilities

- `capability-declaration`: each converter declares what it converts, the CLI and README render
  from that declaration, and drift between declaration and behaviour fails the build.

## Blast radius

Established by grep over `src/` and `tests/` (TypeScript; the LSP under-reported references
earlier in this work, so grep is the ground truth here — 12 references to a symbol where the LSP
returned 2).

**Adding a required field to `Converter` breaks every implementer at compile time**, which is the
desired failure: all six must declare. Affected:

- `src/converters/types.ts` — the interface.
- `src/converters/claude.ts:407`, `opencode.ts:486`, `cursor.ts:163`, `windsurf.ts:135`,
  `copilot.ts:252`, `codex.ts:92` — each `export const <name>Converter: Converter = {` object gains
  `capabilities`.
- `src/index.ts:16` (`Record<string, Converter>`) and `:201-239` (the `list` action).
- `tests/fidelity.test.ts:25` declares `Record<string, Converter>` but only reads
  `detect`/`import`/`export`; unaffected at runtime, recompiled by the type change.
- `src/schema.ts:93-107` — `FidelityItem.kind` becomes `Feature`. Only two consumers of the union
  exist (`src/utils.ts:555`, `:586`, both `FidelityItem["kind"]`), and both keep working because
  the union's members are unchanged.

**Do-not-touch boundaries:**

- No converter's `detect`, `import`, or `export` logic changes. A declaration that disagreed with
  behaviour is fixed by correcting the declaration, not by changing what is written to disk — with
  the single exception named above, where the OpenCode exporter's hook item claimed `lossy` for
  something it does not write.
- Emitted files, frontmatter shape, file naming, and directory layout are untouched. The
  `safe-writes` byte-identical guarantee must still hold for all six targets.
- `permissionActions` stays as the enforcement input for `permissionStatus`. `capabilities` is
  documentation of what converts and must never be consulted to decide whether a permission may
  be written; that decision stays in `permissionStatus`, which is the single never-weaken
  enforcement point.

## Impact

- **APIs:** `Converter` gains a required field. Internal — the package exports a CLI binary, not
  the interface.
- **CLI surface:** `list` stdout changes (more accurate, same shape). `convert` flags, exit codes,
  and `--json` output are unchanged. Two new npm scripts, `docs:matrix` and `docs:check`.
- **Dependencies:** none added. The generator runs under the existing `tsx` devDependency.
- **On-disk/wire formats:** none. No converted output changes.
- **Consumers:** anyone scraping `harnessport list` sees corrected cells. `README.md` gains
  generation markers around the table.
- **Permissions:** this change cannot weaken a security posture. It adds no path that writes a
  permission entry and does not touch `permissionStatus`, `permissionActions`, or
  `partitionPermissions`. The declared capability for permissions is documentation only; the
  never-weaken rule remains enforced solely by `permissionStatus` in `src/utils.ts:517`, whose
  signature takes `(entry, targetActions, targetName)` and so has no access to a converter's
  `capabilities` even if a future edit tried to consult it.

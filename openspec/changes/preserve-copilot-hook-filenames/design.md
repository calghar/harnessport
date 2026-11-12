## Context

The Copilot importer reads every `.github/hooks/*.json` file but flattens all entries into
`HarnessConfig.hooks`. The exporter then writes one `.github/hooks/hooks.json`. The command,
event, matcher, and timeout survive, but the source configuration filename and grouping do not.

The change crosses the canonical `Hook` shape and the Copilot converter. Existing overwrite
protection, hook fidelity decisions, and non-Copilot output must remain unchanged.

## Goals / Non-Goals

**Goals:**

- Carry a Copilot hook entry's source JSON basename through the canonical configuration.
- Group exported Copilot entries by that basename.
- Keep `hooks.json` as the fallback for entries without Copilot file provenance.
- Preserve the existing no-overwrite policy for every emitted file.

**Non-Goals:**

- Preserve filenames through an intermediate non-Copilot configuration.
- Add a runtime hook ID or change command execution.
- Copy referenced scripts, delete stale hook files, or generate purpose names.
- Change hooks from targets other than Copilot.

## Decisions

### Add optional file provenance to `Hook`

Add one optional source-file field to the canonical `Hook`. The Copilot importer sets it to the
basename returned by `.github/hooks` enumeration. Other importers leave it unset.

This keeps provenance beside the entry it groups and handles duplicate events or commands without
inventing a secondary key. A separate configuration-level index was rejected because it would
duplicate the hook list and require synchronization.

The field is target provenance, not runtime hook semantics. Semantic cross-target comparison will
exclude it; Copilot round-trip tests will check it directly.

### Emit one documented wrapper per source file

The Copilot export plan will bucket accepted entries by a validated source basename. Each bucket is
written as `{version: 1, hooks: ...}`. Entries without a valid retained `.json` basename use
`hooks.json`.

Validation accepts only a basename ending in `.json`. Invalid or path-bearing values use the
default file, preventing provenance metadata from selecting a path outside `.github/hooks`.

A single shared emitter will build each file's event table. Separate exporter paths for named and
unnamed hooks were rejected because they would duplicate mapping and fidelity logic.

### Reuse the existing write policy

Every bucket goes through `writeIfNotDry`. A different existing target file remains unchanged and
is reported through the current blocked-write mechanism. The exporter will not remove unreferenced
hook files because it cannot prove ownership.

## Risks / Trade-offs

- **Target provenance expands the canonical hook shape** → Keep the field optional and exclude it
  from cross-target semantic comparison.
- **An old `hooks.json` can remain beside newly named files** → Do not delete user files; document
  that normal overwrite and target-directory rules still apply.
- **Several files can be partly written when one conflicts** → Retain the repository's existing
  per-file write behavior and report each refused path.

## Migration Plan

No persisted data migration is required. Existing canonical hooks without file provenance continue
to export to `.github/hooks/hooks.json`. Rollback removes the optional field and restores the
single-file export.

## Open Questions

None.

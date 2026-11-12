## Why

Copilot accepts purpose-named `.github/hooks/*.json` files, but harnessport discards each source
filename during import and exports every hook to `hooks.json`. A Copilot-to-Copilot conversion
therefore loses human-facing artifact identity even when hook execution remains unchanged.

## What Changes

- Preserve each imported Copilot hook entry's source JSON filename and file grouping when exporting
  back to Copilot.
- Keep `.github/hooks/hooks.json` as the default for hooks that have no Copilot source filename.
- Cover multiple source files and the existing single-file default with executable scenarios.

## Capabilities

### New Capabilities

- `copilot-hook-file-identity`: Copilot hook configuration filenames and their entry grouping survive
  a Copilot import/export conversion.

### Modified Capabilities

None.

## Impact

The canonical hook representation, Copilot converter, hook round-trip tests, generated BDD feature,
README hook fidelity documentation, and changelog may require synchronized changes. No dependency
or CLI interface change is expected.

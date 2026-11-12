## Why

Cursor wrapper files use global numeric names that hide which Claude hook they execute. Preserving
the source hook filename makes generated configuration auditable without opening each wrapper.

## What Changes

- Name generated Cursor wrappers from the source hook command's executable filename.
- Add deterministic suffixes when one source hook needs multiple wrappers or names collide.
- Retain a deterministic fallback for commands without a usable filename.
- Remove obsolete generated wrappers during forced conversion.

## Capabilities

### New Capabilities

- `cursor-hook-wrapper-naming`: Human-readable, unique, and managed names for generated Cursor hook wrappers.

### Modified Capabilities

None.

## Impact

Cursor hook export and cleanup behavior, generated `.cursor/hooks.json` paths, wrapper tests, and
release documentation change. No dependencies or public TypeScript APIs change.

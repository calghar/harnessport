## Context

`exportHooks` currently assigns one global `harnessport-guard-<n>.mjs` sequence to Claude hook
wrappers and MCP permission wrappers. The generated wrapper already records the original hook
command in its first-line metadata.

## Goals / Non-Goals

**Goals:**
- Make Claude hook wrappers identifiable from their filenames.
- Keep names deterministic and unique.
- Remove obsolete generated wrappers safely during forced conversion.

**Non-Goals:**
- Parse arbitrary shell syntax.
- Rename the model-log or formatter wrappers.
- Change wrapper behavior or Cursor hook ordering.

## Decisions

Tokenize the command into quoted or unquoted words. Accept either a directly executed script or the
first non-option argument to `bash`, `sh`, `python`, `python3`, `node`, or `bun`. Commands using
inline interpreter flags such as `-c` or `-e` use the numeric fallback.

Build the readable base with the existing `slugify` helper and Node path functions. A local name
allocator appends `-2`, `-3`, and so on when a base repeats. This avoids a new parser, dependency,
or schema field.

During forced conversion, retain the current legacy numeric-file cleanup and also remove unreferenced
files whose first-line `HOOK` metadata proves that harnessport generated them. Foreign files and
dedicated model-log and formatter wrappers remain untouched.

## Risks / Trade-offs

- Shell constructs outside the stated forms use numeric names → deterministic fallback preserves
  conversion behavior.
- Renaming wrappers leaves old files after a non-forced conversion → they are unreferenced and the
  fidelity reason reports them; `--force` removes them.

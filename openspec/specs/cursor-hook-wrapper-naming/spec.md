# cursor-hook-wrapper-naming Specification

## Purpose
TBD - created by archiving change preserve-cursor-hook-names. Update Purpose after archive.
## Requirements
### Requirement: Cursor wrappers preserve source hook names
The Cursor exporter SHALL name each generated Claude hook wrapper
`harnessport-<source-basename>.mjs`, where `<source-basename>` is the sanitized filename stem of the
directly executed script path or the script path passed to `bash`, `sh`, `python`, `python3`,
`node`, or `bun`.

#### Scenario: Quoted absolute hook path
- **WHEN** a hook command is `bash "$HOME/.claude/hooks/python-guard.sh"`
- **THEN** the generated wrapper is `.cursor/hooks/harnessport-python-guard.mjs`
- **AND** the corresponding Cursor hook entry references that file

#### Scenario: Relative hook path
- **WHEN** a hook command is `./read-size-guard.sh`
- **THEN** the generated wrapper is `.cursor/hooks/harnessport-read-size-guard.mjs`

### Requirement: Cursor wrapper names remain unique
The Cursor exporter SHALL append a numeric suffix starting at `-2` when the same source basename
would otherwise name more than one generated wrapper.

#### Scenario: One hook maps to multiple Cursor events
- **WHEN** one source hook requires three generated wrappers
- **THEN** their names use the source basename with no suffix, `-2`, and `-3`

#### Scenario: Separate hooks share a basename
- **WHEN** separate source hook commands have the same filename stem
- **THEN** every generated wrapper has a distinct deterministic name

### Requirement: Commands without a source filename use fallback names
The Cursor exporter SHALL assign deterministic `harnessport-guard-<n>.mjs` names to wrappers whose
hook command has no directly executed script path or script path passed to a recognized interpreter.

#### Scenario: Inline command
- **WHEN** a hook command has no path or script filename
- **THEN** its wrapper receives the next available `harnessport-guard-<n>.mjs` name

### Requirement: Forced conversion removes obsolete wrappers
During forced conversion, the Cursor exporter SHALL remove obsolete wrappers generated under both
the previous numeric naming scheme and the source-name scheme while preserving unrelated files.

#### Scenario: Source hook was renamed
- **WHEN** a forced conversion no longer references a previously generated source-named wrapper
- **THEN** that obsolete wrapper is removed
- **AND** unrelated files in `.cursor/hooks` remain

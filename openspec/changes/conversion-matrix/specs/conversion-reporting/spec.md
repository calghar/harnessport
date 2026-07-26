## ADDED Requirements

### Requirement: A formatter whose glob Claude Code cannot hold is reported lossy

Claude Code runs a formatter as a `PostToolUse` hook, whose `matcher` selects tool names, not file
paths. A `Formatter.glob` therefore has nowhere to be stored, and the Claude importer re-derives it
from the command with `inferGlobFromCommand`. Where that re-derivation would not reproduce the
original glob, the export SHALL be reported `lossy`, naming the glob that will be seen instead. It
SHALL NOT be reported `exact`.

A widened glob is the dangerous direction: `*.ts` becoming `*` runs the formatter over every file
in the repository.

#### Scenario: An unrecognised formatter command widens the glob and says so
- **GIVEN** a canonical config holding a formatter with glob `*.ts` and command `biome format --write`
- **WHEN** exporting to claude
- **THEN** the `formatter` item named `*.ts` has status `lossy`
- **AND** its reason names `*`, the glob Claude Code will see instead

#### Scenario: A recognised formatter command round-trips exactly
- **GIVEN** a canonical config holding a formatter with glob `*.py` and command `ruff format`
- **WHEN** exporting to claude
- **THEN** the `formatter` item named `*.py` has status `exact`

#### Scenario: The emitted hook is unchanged
- **GIVEN** a canonical config holding a formatter with glob `*.ts` and command `biome format --write`
- **WHEN** exporting to claude
- **THEN** `.claude/settings.json` holds a `PostToolUse` hook with matcher `Edit|Write|MultiEdit`
- **AND** its command is `biome format --write $FILEPATH`

#### Scenario: The widened glob is what re-import actually yields
- **GIVEN** a canonical config holding a formatter with glob `*.ts` and command `biome format --write`
- **WHEN** exporting to claude and re-importing from claude
- **THEN** the re-imported formatter's glob is `*`

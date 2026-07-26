## ADDED Requirements

### Requirement: A hook OpenCode cannot run is reported dropped

The OpenCode exporter writes no representation of a `Hook`. It SHALL therefore report each hook as
`dropped`, not `lossy`. `lossy` means content was written with detail removed; nothing is written
here, and the distinction is what lets a reader tell "in the file, minus a field" from "not in the
file at all".

#### Scenario: A claude PreToolUse hook exported to opencode is dropped
- **GIVEN** a canonical config holding a hook on event `PreToolUse`
- **WHEN** exporting to opencode
- **THEN** the item of kind `hook` named `PreToolUse` has status `dropped`
- **AND** its reason states that OpenCode supports only formatters

#### Scenario: A dropped hook does not fail the run
- **GIVEN** a canonical config holding a hook on event `PreToolUse` and nothing blocked
- **WHEN** converting from claude to opencode
- **THEN** the process exits `0`

#### Scenario: Formatters are still converted
- **GIVEN** a canonical config holding one formatter and one hook
- **WHEN** exporting to opencode
- **THEN** the emitted `opencode.json` carries a `formatter` key
- **AND** the item of kind `formatter` has status `exact`

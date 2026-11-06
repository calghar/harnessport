## ADDED Requirements

### Requirement: A refused hooks.json never reports a guardrail as written
The Cursor exporter SHALL report each PreToolUse hook item as `blocked`, with a reason, when the write of `.cursor/hooks.json` is refused, and the CLI SHALL exit with code 2.

#### Scenario: A refused hooks.json blocks the guardrail and exits 2
- **GIVEN** an existing `.cursor/hooks.json` with content `{"version":1,"hooks":{"afterFileEdit":[{"command":"./audit.sh"}]}}`
- **WHEN** a Claude project with one PreToolUse guardrail (Bash, command `./guard.sh`) is converted to Cursor without `--force`
- **THEN** the item for the guardrail (kind `hook`, name `PreToolUse`) has status `blocked` with a non-empty reason
- **AND** `.cursor/hooks.json` keeps its content
- **AND** the process exits with code 2

### Requirement: A successful hooks.json write keeps its hook status
The Cursor exporter SHALL report a PreToolUse hook item as `exact` or `lossy`, as determined by its matcher, when `.cursor/hooks.json` is written.

#### Scenario: A written hooks.json keeps the exact status
- **GIVEN** no `.cursor/hooks.json` in the target
- **WHEN** a Claude project with one PreToolUse guardrail (Bash, command `./guard.sh`) is converted to Cursor
- **THEN** the item for the guardrail has status `exact`
- **AND** `.cursor/hooks.json` holds one `preToolUse` entry
- **AND** the process exits with code 0

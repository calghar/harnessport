## REMOVED Requirements

### Requirement: A hook OpenCode cannot run is reported dropped

**Reason**: It reports every OpenCode hook as `dropped` and expects exit `0` for PreToolUse. A
PreToolUse guardrail is now `blocked` and exits `2` (`hook-guardrails`). `MODIFIED` cannot drop a
scenario, so the requirement is removed and re-added under a new name.

**Migration**: `OpenCode reports an unwritten hook by whether its event is a guardrail`, below.
The scenario "Formatters are still converted" is covered by "Formatters on opencode are unchanged"
in `hook-guardrails`.

## ADDED Requirements

### Requirement: OpenCode reports an unwritten hook by whether its event is a guardrail

The OpenCode exporter writes no representation of a `Hook`. It SHALL report a hook on a guardrail
event as `blocked` and a hook on any other event as `dropped`, never `lossy`. The exit code follows
`hook-guardrails`: `blocked` exits `2`, `dropped` leaves it unchanged.

#### Scenario: A PreToolUse hook fails the opencode run
- **GIVEN** a canonical config holding only a hook `{event: "PreToolUse", matcher: "Bash", command: "./guard.sh"}`
- **WHEN** converting from claude to opencode
- **THEN** the item of kind `hook` named `PreToolUse` has status `blocked`
- **AND** the process exits `2`

#### Scenario: A PostToolUse hook does not fail the opencode run
- **GIVEN** a canonical config holding only a hook `{event: "PostToolUse", matcher: "Bash", command: "./log.sh"}`
- **WHEN** converting from claude to opencode
- **THEN** the item of kind `hook` named `PostToolUse` has status `dropped`
- **AND** the process exits `0`

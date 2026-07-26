## ADDED Requirements

### Requirement: check compares the harness configs present in one repository

`harnessport check <dir>` SHALL detect every harness configured in `<dir>`, import each, and
compare their canonical configs pairwise on the named things each holds. It SHALL write nothing,
create nothing, and delete nothing.

#### Scenario: The inspected directory is left alone
- **GIVEN** a directory holding both claude and opencode configuration
- **WHEN** running check against it
- **THEN** the set of files under that directory is unchanged
- **AND** their contents are unchanged

#### Scenario: Fewer than two harnesses is nothing to compare
- **GIVEN** a directory whose only configuration is claude
- **WHEN** running check against it
- **THEN** the process exits `0`
- **AND** the output states that only one harness was found

#### Scenario: No configuration at all cannot run
- **GIVEN** an empty directory
- **WHEN** running check against it
- **THEN** the process exits `1`

### Requirement: check reports divergence and fails on it

Where two detected harnesses hold different sets of named items, each difference SHALL be reported
naming the harness that has the item and the harness that does not. The process SHALL exit `2`
when any divergence is found and `0` when the detected harnesses agree.

#### Scenario: A skill present in one harness only is reported
- **GIVEN** a directory holding a claude skill named `testing` and an opencode config with no
  skills
- **WHEN** running check against it
- **THEN** the output names `testing` as present in claude and absent from opencode
- **AND** the process exits `2`

#### Scenario: Agreeing configs pass
- **GIVEN** a directory holding claude and opencode configs with the same rules and no other items
- **WHEN** running check against it
- **THEN** the process exits `0`

#### Scenario: Rules are compared by content, not by file name
- **GIVEN** a directory where claude's `CLAUDE.md` and opencode's `AGENTS.md` hold the same text
- **WHEN** running check against it
- **THEN** no rule divergence is reported

### Requirement: check reports as JSON on request

With `--json`, the report SHALL be written to stdout as JSON carrying `detected` and
`divergences`, each divergence naming `kind`, `name`, `presentIn`, and `absentFrom`.
Human-readable output SHALL go to stderr.

#### Scenario: JSON output parses and carries the detected harnesses
- **GIVEN** a directory holding both claude and opencode configuration
- **WHEN** running check with `--json`
- **THEN** stdout parses as JSON
- **AND** its `detected` array contains `claude` and `opencode`

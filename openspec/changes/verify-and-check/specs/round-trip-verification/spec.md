## ADDED Requirements

### Requirement: verify round-trips a repository without touching it

`harnessport verify <dir> --from X --to Y` SHALL import `<dir>` as harness X, export to a
directory it creates under the system temporary directory, and re-import that with harness Y. It
SHALL NOT create, modify, or delete any file under `<dir>`.

#### Scenario: The inspected directory is left alone
- **GIVEN** a claude project directory
- **WHEN** running verify from claude to opencode against it
- **THEN** the set of files under that directory is unchanged
- **AND** their contents are unchanged

#### Scenario: An unknown harness name cannot run
- **WHEN** running verify with `--from` naming a harness that does not exist
- **THEN** the process exits `1`

#### Scenario: A directory holding no source config cannot run
- **GIVEN** an empty directory
- **WHEN** running verify from claude to opencode against it
- **THEN** the process exits `1`

### Requirement: verify separates accounted-for loss from unaccounted loss

Every named item present before the round trip and absent after SHALL be classified. An item named
by a fidelity item of the same kind whose status is `lossy`, `dropped`, or `blocked` is
**accounted for**. An item with no such fidelity item is **unaccounted**. Permission tool names
SHALL be compared case-insensitively, since a harness's own config casing is not a loss.

#### Scenario: A dropped permission is accounted for
- **GIVEN** a claude project holding a `Bash` allow permission
- **WHEN** running verify from claude to cursor
- **THEN** the permission is reported as accounted-for loss
- **AND** it is not reported as unaccounted

#### Scenario: A surviving item is not reported as lost
- **GIVEN** a claude project holding a skill named `testing`
- **WHEN** running verify from claude to opencode
- **THEN** no loss of kind `skill` is reported

#### Scenario: Lowercase tool naming is not treated as loss
- **GIVEN** an opencode project holding a `bash` permission
- **WHEN** running verify from opencode to claude
- **THEN** no loss of kind `permission` is reported for it

### Requirement: verify exits 2 only on unaccounted loss

The process SHALL exit `0` when every loss is accounted for, however much was lost, and exit `2`
when any loss is unaccounted. Accounted-for loss is the tool working correctly; unaccounted loss
means the fidelity report is wrong.

#### Scenario: A lossy but honest conversion passes
- **WHEN** running verify from `<from>` to `<to>` against that harness's fixture
- **THEN** the process exits `0`

#### Examples:
| from     | to       |
|----------|----------|
| claude   | opencode |
| claude   | cursor   |
| claude   | codex    |
| opencode | claude   |
| cursor   | claude   |
| codex    | copilot  |

#### Scenario: Unaccounted loss fails the run
- **GIVEN** a conversion whose fidelity report claims `exact` for an item that does not survive
- **WHEN** running verify
- **THEN** the process exits `2`
- **AND** the item is named in the unaccounted list

### Requirement: verify reports as JSON on request

With `--json`, the report SHALL be written to stdout as JSON carrying `from`, `to`, `accounted`,
and `unaccounted`, each loss naming its `kind` and `name`. Human-readable output SHALL go to
stderr so stdout stays parseable.

#### Scenario: JSON output parses and carries both lists
- **WHEN** running verify from claude to cursor with `--json`
- **THEN** stdout parses as JSON
- **AND** it carries `accounted` and `unaccounted` arrays
- **AND** every entry has a `kind` and a `name`

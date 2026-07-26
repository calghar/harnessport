## ADDED Requirements

### Requirement: Conversion fidelity is reported per item

Importing and exporting SHALL each produce a list of `FidelityItem`. Each item SHALL carry the phase
it arose in, the kind of thing it describes, a name identifying it, and a status of `exact`, `lossy`,
`dropped`, or `blocked`. Every item whose status is not `exact` SHALL carry a reason.

`exact` means the item crossed the boundary with nothing dropped. `lossy` means it was written with
detail dropped. `dropped` means it was not written because the target has no equivalent concept.
`blocked` means it was refused, because writing it would misrepresent the source or weaken a
security posture.

The distinction between `dropped` and `blocked` SHALL determine the exit code: a target simply
lacking a concept is ordinary, while a refusal is exceptional.

#### Scenario: A feature the target cannot represent is reported per item
- **GIVEN** a config holding two agents
- **WHEN** exporting to windsurf, which has no per-agent tool or model config
- **THEN** two items of kind `agent` are reported, each naming its agent
- **AND** neither item has status `blocked`

#### Scenario: Import-side loss enters the same report
- **WHEN** importing from codex, whose MCP servers live in user-level TOML that is not read
- **THEN** an item with phase `import` and a reason naming `~/.codex/config.toml` is reported

#### Scenario: A non-exact item always explains itself
- **WHEN** any conversion produces an item whose status is `lossy` or `blocked`
- **THEN** that item carries a non-empty reason

#### Scenario: A fully representable feature is reported exact
- **GIVEN** a config holding one skill
- **WHEN** exporting to opencode, which supports skills natively
- **THEN** one item of kind `skill` with status `exact` is reported

### Requirement: A reported outcome matches what was written

An item SHALL describe what the code actually did. A status of `exact` or `lossy` SHALL NOT be
reported for content that no code path writes; such content SHALL be reported as `dropped`.

#### Scenario: Agents not written to windsurf are reported dropped, not carried
- **GIVEN** a config holding two agents
- **WHEN** exporting to windsurf
- **THEN** either the emitted files contain both agent bodies, or both items have status `dropped`

#### Scenario: Codex agent reporting matches its emitted output
- **GIVEN** a config holding two agents
- **WHEN** exporting to codex
- **THEN** either `AGENTS.md` contains both agent bodies, or both items have status `dropped`

#### Scenario: No reason claims a merge that did not happen
- **GIVEN** a config holding two agents
- **WHEN** exporting to windsurf or codex
- **THEN** no item reason states that agent content was merged unless an emitted file contains it

### Requirement: Exit codes distinguish refusal from ordinary loss

`convert` SHALL exit `2` when any item has status `blocked`. It SHALL exit `0` when no item is
blocked, including when items are `lossy` or `dropped`. Existing failure exits SHALL be unchanged: an
unknown harness name or an absent source configuration SHALL continue to exit `1`.

#### Scenario: A lossy conversion succeeds
- **GIVEN** a claude config whose hooks cannot be represented by cursor
- **WHEN** converting from claude to cursor with no blocked items
- **THEN** the process exits `0`

#### Scenario: A conversion that only drops unsupported concepts succeeds
- **GIVEN** a claude config holding agents and no deny permissions
- **WHEN** converting from claude to windsurf, which has no agent config
- **THEN** the process exits `0`

#### Scenario: A blocked conversion signals failure
- **GIVEN** a claude config holding a `deny` permission
- **WHEN** converting from claude to cursor
- **THEN** the process exits `2`

#### Scenario: Existing failure modes keep their exit code
- **WHEN** invoking convert with `<condition>`
- **THEN** the process exits `<code>`

#### Examples:
| condition                          | code |
|------------------------------------|------|
| an unknown source harness name     | 1    |
| an unknown target harness name     | 1    |
| identical source and target        | 1    |
| no source configuration present    | 1    |

### Requirement: The item list is available as JSON

`convert` SHALL accept a `--json` flag that writes the item list to stdout as JSON. The JSON output
SHALL be the stable machine-readable surface, and SHALL be emitted in dry-run as well as on a real
run.

#### Scenario: JSON output parses and carries every item
- **WHEN** converting with `--json`
- **THEN** stdout parses as JSON
- **AND** it contains one entry per reported item, each with phase, kind, name, and status

#### Scenario: JSON output is available without writing files
- **WHEN** converting with both `--json` and `--dry-run`
- **THEN** stdout parses as JSON
- **AND** no file is written

#### Scenario: Exit code accompanies JSON output
- **GIVEN** a config holding a `deny` permission bound for cursor
- **WHEN** converting with `--json`
- **THEN** stdout parses as JSON
- **AND** the process exits `2`

### Requirement: Reported version matches the package

The CLI SHALL report the version recorded in `package.json`.

#### Scenario: Version is not hardcoded
- **WHEN** invoking the CLI with `--version`
- **THEN** the printed version equals the `version` field of `package.json`

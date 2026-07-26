## ADDED Requirements

### Requirement: Every ordered pair of harnesses converts end to end

For each of the 30 ordered pairs of the six harnesses, importing that harness's fixture and
exporting to the target SHALL write files to a real directory that the target converter's `detect`
recognises as its own configuration.

#### Scenario: The target recognises what was written
- **GIVEN** the fixture for source harness `<from>`
- **WHEN** importing from `<from>` and exporting to `<to>` in an empty directory
- **THEN** `<to>`'s `detect` returns true for that directory

#### Examples:
| from     | to       |
|----------|----------|
| claude   | opencode |
| claude   | cursor   |
| claude   | windsurf |
| claude   | copilot  |
| claude   | codex    |
| opencode | claude   |
| opencode | cursor   |
| opencode | windsurf |
| opencode | copilot  |
| opencode | codex    |
| cursor   | claude   |
| cursor   | opencode |
| cursor   | windsurf |
| cursor   | copilot  |
| cursor   | codex    |
| windsurf | claude   |
| windsurf | opencode |
| windsurf | cursor   |
| windsurf | copilot  |
| windsurf | codex    |
| copilot  | claude   |
| copilot  | opencode |
| copilot  | cursor   |
| copilot  | windsurf |
| copilot  | codex    |
| codex    | claude   |
| codex    | opencode |
| codex    | cursor   |
| codex    | windsurf |
| codex    | copilot  |

#### Scenario: Each importer reads its own fixture
- **WHEN** importing the fixture for `<harness>` with that harness's converter
- **THEN** at least one rule is read
- **AND** at least one skill is read

#### Examples:
| harness  |
|----------|
| claude   |
| opencode |
| cursor   |
| windsurf |
| copilot  |
| codex    |

### Requirement: Rule text and skill names survive every pair

Every harness converts rules and skills, so no ordered pair may lose either. Exporting to a
target and re-importing SHALL yield rule content containing each source rule's text, and a skill
named for each source skill.

#### Scenario: Rule text survives the round trip
- **GIVEN** the fixture for source harness `<from>`
- **WHEN** importing from `<from>`, exporting to `<to>`, and re-importing with `<to>`
- **THEN** the re-imported rule text contains each source rule's first line

#### Examples:
| from     | to       |
|----------|----------|
| cursor   | claude   |
| claude   | codex    |
| copilot  | windsurf |
| windsurf | opencode |
| codex    | cursor   |
| opencode | copilot  |

#### Scenario: Skill names survive the round trip
- **GIVEN** the fixture for source harness `<from>`
- **WHEN** importing from `<from>`, exporting to `<to>`, and re-importing with `<to>`
- **THEN** every source skill name is present in the re-imported skills

#### Examples:
| from     | to       |
|----------|----------|
| cursor   | claude   |
| claude   | codex    |
| copilot  | windsurf |
| windsurf | opencode |
| codex    | cursor   |
| opencode | copilot  |

### Requirement: Re-running a conversion changes nothing

Exporting the same config to the same directory twice SHALL write no new content and SHALL report
no `blocked` item that the first run did not also report, so a conversion re-run in CI is a no-op
rather than a wall of refused overwrites.

#### Scenario: The second run reports the same blocked set as the first
- **GIVEN** a directory already holding the output of converting `<from>` to `<to>`
- **WHEN** exporting the same config to that directory again
- **THEN** the set of blocked item names equals that of the first run

#### Examples:
| from     | to       |
|----------|----------|
| claude   | opencode |
| opencode | claude   |
| cursor   | copilot  |
| copilot  | codex    |

### Requirement: Anything lost is accounted for

For every ordered pair, an agent, skill, command, MCP server, permission, hook, or formatter
present in the source config and absent after re-importing from the target SHALL be named by a
fidelity item of the same kind whose status is `lossy`, `dropped`, or `blocked`. Nothing may
disappear while every item reads `exact`.

#### Scenario: No unexplained loss on any pair
- **GIVEN** the fixture for source harness `<from>`
- **WHEN** importing from `<from>`, exporting to `<to>`, and re-importing with `<to>`
- **THEN** every named item missing after the round trip is named by a non-`exact` fidelity item
  of the same kind

#### Examples:
| from     | to       |
|----------|----------|
| claude   | opencode |
| claude   | cursor   |
| claude   | codex    |
| opencode | claude   |
| opencode | cursor   |
| cursor   | claude   |
| cursor   | opencode |
| windsurf | claude   |
| copilot  | claude   |
| copilot  | opencode |
| codex    | claude   |
| codex    | opencode |

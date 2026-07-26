## ADDED Requirements

### Requirement: Two inputs never collapse onto one output file

Where two items would derive the same output filename, the names SHALL be disambiguated so each
item gets its own file, and each disambiguation SHALL be reported as a `lossy` item naming the
original and the path actually used.

#### Scenario: Skills differing only by case each get a file
- **GIVEN** a config holding skills named `Testing` and `testing`
- **WHEN** exporting to any harness that writes skills
- **THEN** two distinct `SKILL.md` files are written
- **AND** both skill bodies are present on disk

#### Scenario: Skills differing only by separator each get a file
- **GIVEN** a config holding skills named `code review` and `code-review`
- **WHEN** exporting to any harness that writes skills
- **THEN** two distinct `SKILL.md` files are written

#### Scenario: A disambiguation is reported
- **GIVEN** a config holding two skills whose names slugify identically
- **WHEN** exporting
- **THEN** a `lossy` item is reported naming the collision

#### Scenario: Rules without a source name do not collapse
- **GIVEN** a config holding three rules that each have a glob and no source filename
- **WHEN** exporting to copilot
- **THEN** three distinct `.instructions.md` files are written

### Requirement: A formatter keeps its own identity

A formatter's emitted name SHALL derive from its own command. Distinct commands SHALL NOT be
mapped onto one shared name, and two formatters SHALL NOT collapse into a single entry.

#### Scenario: Two Python formatters both survive
- **GIVEN** a config holding a `black` formatter and an `isort` formatter
- **WHEN** exporting to opencode
- **THEN** `opencode.json` holds two formatter entries
- **AND** neither entry's command contradicts its name

#### Scenario: A formatter's name reflects its command
- **GIVEN** a config holding a formatter whose command is `<command>`
- **WHEN** exporting to opencode
- **THEN** the emitted formatter key is `<name>`

#### Examples:
| command  | name     |
|----------|----------|
| black    | black    |
| isort    | isort    |
| ruff     | ruff     |
| prettier | prettier |
| gofmt    | gofmt    |

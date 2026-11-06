## ADDED Requirements

### Requirement: Cursor permission export never widens an allow
The Cursor exporter SHALL write a Claude permission entry to `.cursor/cli.json` only when the written Cursor rule matches no more commands or paths than the entry.

#### Scenario: A Bash allow with a pattern is dropped
- **GIVEN** a canonical permission with tool `Bash`, pattern `<pattern>`, action `allow`
- **WHEN** the Cursor exporter exports the config into an empty project
- **THEN** the item for `Bash(<pattern>)` has status `dropped`
- **AND** `.cursor/cli.json` is not written

#### Examples:
| pattern        |
|----------------|
| git push *     |
| npm test       |
| rm -rf dist    |

#### Scenario: A Bash allow for every command is exact
- **GIVEN** a canonical permission with tool `Bash`, pattern `*`, action `allow`
- **WHEN** the Cursor exporter exports the config into an empty project
- **THEN** the item for `Bash(*)` has status `exact`
- **AND** `.cursor/cli.json` holds `Shell(*)` in `permissions.allow`

### Requirement: Cursor permission export never narrows a deny
The Cursor exporter SHALL write a Claude `deny` only as a Cursor rule that matches every command or path the Claude rule matches, and SHALL block the entry when no such rule is verified.

#### Scenario: A Bash deny with a pattern becomes a command-base deny
- **GIVEN** a canonical permission with tool `Bash`, pattern `<pattern>`, action `deny`
- **WHEN** the Cursor exporter exports the config into an empty project
- **THEN** the item for `Bash(<pattern>)` has status `lossy`
- **AND** its reason says the deny covers every command with the same first token
- **AND** `.cursor/cli.json` holds `Shell(<base>)` in `permissions.deny`

#### Examples:
| pattern        | base  |
|----------------|-------|
| git push *     | git   |
| rm -rf dist    | rm    |
| npm run:*      | npm   |

#### Scenario: A deny on a path or domain tool is blocked
- **GIVEN** a canonical permission with tool `<tool>`, pattern `<pattern>`, action `deny`
- **WHEN** the Cursor exporter exports the config into an empty project
- **THEN** the item for `<tool>(<pattern>)` has status `blocked`
- **AND** `.cursor/cli.json` is not written for it

#### Examples:
| tool      | pattern          |
|-----------|------------------|
| Read      | .env             |
| Edit      | secrets/**       |
| WebFetch  | domain:evil.test |

#### Scenario: A user-level target blocks a deny instead of dropping it
- **GIVEN** a canonical permission with tool `Bash`, pattern `rm -rf dist`, action `deny`
- **WHEN** the Cursor exporter exports the config with the target equal to the home directory
- **THEN** the item for `Bash(rm -rf dist)` has status `blocked`
- **AND** `.cursor/cli.json` is not written

#### Scenario: An ask rule is blocked
- **GIVEN** a canonical permission with tool `Bash`, pattern `git push *`, action `ask`
- **WHEN** the Cursor exporter exports the config into an empty project
- **THEN** the item for `Bash(git push *)` has status `blocked`
- **AND** the item's reason states that the `ask` rule is refused rather than written as an allow

### Requirement: Cursor formatter export runs through afterFileEdit
The Cursor exporter SHALL write each formatter whose glob and command contain none of the characters `"`, `'`, `|`, `&`, `;`, `$`, `<`, `>`, or a backtick, as an `afterFileEdit` entry in `.cursor/hooks.json` that runs `.cursor/hooks/harnessport-format.mjs` with the formatter's glob and command. A formatter containing any of those characters SHALL be reported dropped.

#### Scenario: A shell-free formatter is written
- **GIVEN** a canonical formatter with glob `*.py` and command `ruff format`
- **WHEN** the Cursor exporter exports the config into an empty project
- **THEN** the item for `*.py` has status `lossy`
- **AND** its reason names Third-Party Imports
- **AND** `.cursor/hooks.json` holds an `afterFileEdit` entry whose command runs `.cursor/hooks/harnessport-format.mjs "*.py" ruff format`
- **AND** `.cursor/hooks/harnessport-format.mjs` exists

#### Scenario: A formatter that needs a shell is dropped
- **GIVEN** a canonical formatter with glob `*.ts` and command `prettier --write | tee log`
- **WHEN** the Cursor exporter exports the config into an empty project
- **THEN** the item for `*.ts` has status `dropped`
- **AND** no `afterFileEdit` entry is written for it

#### Scenario: The runner passes the edited file only when its glob matches
- **GIVEN** the runner written for glob `*.py` and command `ruff format`
- **WHEN** Cursor sends an `afterFileEdit` payload whose `file_path` is `<file>`
- **THEN** the formatter command runs on `<file>` when `<runs>` is `yes`, and does not run when `<runs>` is `no`

#### Examples:
| file           | runs |
|----------------|------|
| src/app.py     | yes  |
| docs/readme.md | no   |

### Requirement: Cursor formatter import reads harnessport's afterFileEdit entries
The Cursor importer SHALL import each `afterFileEdit` entry that runs the harnessport formatter runner as a canonical formatter, and SHALL report every other `afterFileEdit` entry as dropped.

#### Scenario: A harnessport formatter entry round-trips
- **GIVEN** `.cursor/hooks.json` written by the Cursor exporter for glob `*.py` and command `ruff format`
- **WHEN** the Cursor importer imports the project
- **THEN** the canonical formatters hold glob `*.py` and command `ruff format`

#### Scenario: A foreign afterFileEdit entry is reported, not imported
- **GIVEN** `.cursor/hooks.json` with an `afterFileEdit` entry whose command is `./audit.sh`
- **WHEN** the Cursor importer imports the project
- **THEN** the canonical formatters are empty
- **AND** the import items hold a dropped hook item for `afterFileEdit`

### Requirement: Cursor hooks file holds both events in one write
The Cursor exporter SHALL write `.cursor/hooks.json` once, holding `preToolUse` entries and `afterFileEdit` entries together.

#### Scenario: Guardrails and formatters share one hooks file
- **GIVEN** a canonical config with one PreToolUse guardrail and one shell-free formatter
- **WHEN** the Cursor exporter exports the config into an empty project
- **THEN** `.cursor/hooks.json` holds a `preToolUse` array and an `afterFileEdit` array
- **AND** the PreToolUse guardrail's wrapper is still written as before

### Requirement: Existing Cursor permission and hook files are never clobbered
The Cursor exporter SHALL refuse to replace an existing `.cursor/cli.json` or `.cursor/hooks.json` whose content differs, unless `--force` is given, which SHALL keep a `.bak` copy.

#### Scenario: A differing cli.json is refused and its permission items are blocked
- **GIVEN** an existing `.cursor/cli.json` with content `{"permissions":{"allow":["Shell(ls)"],"deny":[]}}`
- **WHEN** the Cursor exporter exports a config with one Bash deny `rm -rf dist`, without `--force`
- **THEN** `.cursor/cli.json` keeps its content
- **AND** the item for `.cursor/cli.json` has status `blocked`
- **AND** the item for `Bash(rm -rf dist)` has status `blocked`, not `lossy`

#### Scenario: A refused hooks.json blocks its formatter items
- **GIVEN** an existing `.cursor/hooks.json` with content `{"version":1,"hooks":{"afterFileEdit":[{"command":"./audit.sh"}]}}`
- **WHEN** the Cursor exporter exports a config with one shell-free formatter `*.py` `ruff format`, without `--force`
- **THEN** `.cursor/hooks.json` keeps its content
- **AND** the item for `*.py` has status `blocked`, not `exact`

#### Scenario: A refused hooks.json blocks the PreToolUse guardrail
- **GIVEN** an existing `.cursor/hooks.json` with content `{"version":1,"hooks":{"afterFileEdit":[{"command":"./audit.sh"}]}}`
- **WHEN** the Cursor exporter exports a config with one PreToolUse guardrail (Bash, command `./guard.sh`), without `--force`
- **THEN** the item for the guardrail (kind `hook`, name `PreToolUse`) has status `blocked`
- **AND** `.cursor/hooks.json` keeps its content

### Requirement: Cursor permissions are not imported
The Cursor importer SHALL return no permissions, even when `.cursor/cli.json` holds rules.

#### Scenario: A cli.json with rules imports no permissions
- **GIVEN** `.cursor/cli.json` with `permissions.allow` holding `Shell(ls)`
- **WHEN** the Cursor importer imports the project
- **THEN** the canonical permissions are empty

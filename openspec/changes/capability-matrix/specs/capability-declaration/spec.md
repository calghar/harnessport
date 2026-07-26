## ADDED Requirements

### Requirement: Every converter declares what it converts

Each converter SHALL carry a `capabilities` record keyed by every member of the `Feature` union
(`rule`, `agent`, `skill`, `command`, `mcp`, `permission`, `hook`, `formatter`), with each value one
of:

- `full` — harnessport both imports and exports this feature for this harness;
- `user-level` — the harness stores this feature outside the repository (a path under `~`), which
  harnessport neither reads nor writes;
- `none` — harnessport does not convert this feature for this harness.

The record SHALL be total: a converter that omits a feature key, or a `Feature` member that no
converter declares, SHALL fail type checking.

#### Scenario: Every converter declares every feature
- **GIVEN** the six converters claude, opencode, cursor, windsurf, copilot, and codex
- **WHEN** reading each converter's `capabilities`
- **THEN** each declares a value for all eight features
- **AND** each value is one of `full`, `user-level`, or `none`

#### Scenario: The declaration records what the converters implement
- **WHEN** reading the `capabilities` of converter `<tool>` for feature `<feature>`
- **THEN** the declared value is `<value>`

#### Examples:
| tool     | feature    | value      |
|----------|------------|------------|
| cursor   | agent      | full       |
| cursor   | skill      | full       |
| cursor   | command    | full       |
| cursor   | mcp        | full       |
| copilot  | agent      | full       |
| copilot  | skill      | full       |
| copilot  | command    | full       |
| copilot  | mcp        | full       |
| copilot  | hook       | full       |
| windsurf | agent      | none       |
| windsurf | mcp        | user-level |
| windsurf | command    | full       |
| codex    | agent      | user-level |
| codex    | mcp        | user-level |
| codex    | command    | none       |
| codex    | hook       | full       |
| codex    | permission | none       |
| opencode | hook       | none       |
| opencode | formatter  | full       |
| claude   | permission | full       |
| claude   | formatter  | full       |

### Requirement: A declaration disagreeing with export behaviour fails the build

For every converter and every feature, exporting a canonical config that holds at least one item of
that feature SHALL produce fidelity items whose statuses agree with the declaration:

- a feature declared `full` SHALL produce at least one item of that kind whose status is `exact` or
  `lossy`;
- a feature declared `user-level` or `none` SHALL produce items of that kind whose statuses are all
  `dropped` or `blocked`, and none `exact` or `lossy`.

#### Scenario: A feature declared full is represented in the output
- **GIVEN** a canonical config holding one rule, agent, skill, command, MCP server, permission,
  hook, and formatter
- **WHEN** exporting to `<tool>` and inspecting the items of kind `<feature>`
- **THEN** at least one item has status `exact` or `lossy`

#### Examples:
| tool     | feature   |
|----------|-----------|
| claude   | agent     |
| claude   | hook      |
| claude   | formatter |
| opencode | agent     |
| opencode | formatter |
| cursor   | agent     |
| copilot  | hook      |
| codex    | hook      |

#### Scenario: A feature declared unconverted is never reported as written
- **GIVEN** a canonical config holding one rule, agent, skill, command, MCP server, permission,
  hook, and formatter
- **WHEN** exporting to `<tool>` and inspecting the items of kind `<feature>`
- **THEN** no item has status `exact`
- **AND** no item has status `lossy`

#### Examples:
| tool     | feature    |
|----------|------------|
| windsurf | agent      |
| windsurf | mcp        |
| windsurf | hook       |
| cursor   | permission |
| cursor   | hook       |
| cursor   | formatter  |
| copilot  | permission |
| copilot  | formatter  |
| codex    | agent      |
| codex    | command    |
| codex    | mcp        |
| opencode | hook       |

### Requirement: A user-level declaration names the path it lives at

Where a converter declares a feature `user-level`, the fidelity item it emits for that feature on
export SHALL carry a reason naming the out-of-repository path holding it, so a user can copy the
configuration across by hand.

#### Scenario: Windsurf MCP names the user-level config file
- **GIVEN** a canonical config holding one MCP server
- **WHEN** exporting to windsurf
- **THEN** the `mcp` item's reason contains `~/.codeium/windsurf/mcp_config.json`

#### Scenario: Codex agents name the user-level config file
- **GIVEN** a canonical config holding one agent
- **WHEN** exporting to codex
- **THEN** the `agent` item's reason contains `~/.codex/config.toml`

### Requirement: The list command renders from the declaration

`harnessport list` SHALL render its matrix from `Converter.capabilities` rather than from hardcoded
output, showing `✓` for `full`, `~` for `user-level`, and `-` for `none`, with a legend defining
each. It SHALL NOT report a feature as unavailable when the converter implements it.

#### Scenario: A previously under-reported cell now reads supported
- **WHEN** running `harnessport list`
- **THEN** the row for `<feature>` shows `<symbol>` in the `<tool>` column

#### Examples:
| tool     | feature     | symbol |
|----------|-------------|--------|
| cursor   | Agents      | ✓      |
| cursor   | Skills      | ✓      |
| cursor   | Commands    | ✓      |
| copilot  | Agents      | ✓      |
| copilot  | Skills      | ✓      |
| copilot  | Commands    | ✓      |
| copilot  | MCP Servers | ✓      |
| copilot  | Hooks       | ✓      |
| windsurf | MCP Servers | ~      |
| windsurf | Agents      | -      |
| codex    | Agents      | ~      |
| codex    | Permissions | -      |

#### Scenario: The legend defines all three symbols
- **WHEN** running `harnessport list`
- **THEN** the output explains `✓`, `~`, and `-`

### Requirement: The README matrix is generated and drift fails the check

`README.md` SHALL carry the support matrix between generation markers, rendered from
`Converter.capabilities`. `npm run docs:matrix` SHALL rewrite that region. `npm run docs:check`
SHALL exit non-zero when the region does not match what the declaration renders, and SHALL run as
part of `npm run check`.

#### Scenario: A matching README passes the check
- **GIVEN** a README whose matrix region was written by the generator
- **WHEN** running the drift check
- **THEN** it exits `0`

#### Scenario: An edited README fails the check
- **GIVEN** a README whose matrix region has been edited by hand to disagree with the declaration
- **WHEN** running the drift check
- **THEN** it exits non-zero
- **AND** the message names `npm run docs:matrix` as the fix

#### Scenario: Regeneration is idempotent
- **GIVEN** a README whose matrix region was written by the generator
- **WHEN** running the generator again
- **THEN** the file is unchanged

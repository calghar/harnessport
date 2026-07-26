## ADDED Requirements

### Requirement: Permission entries carry an action

A `PermissionEntry` SHALL carry an `action` of `allow`, `ask`, or `deny`. Importers SHALL set it
from the source harness. Where a source expresses no action, the entry SHALL default to `allow`.

#### Scenario: OpenCode deny survives import
- **GIVEN** an `opencode.json` containing `{"permission": {"bash": {"rm -rf *": "deny"}}}`
- **WHEN** importing from opencode
- **THEN** the config contains a permission entry with tool `bash`, pattern `rm -rf *`, and action `deny`

#### Scenario: Claude deny list is imported
- **GIVEN** a `.claude/settings.json` whose `permissions.deny` contains `Bash(curl *)`
- **WHEN** importing from claude
- **THEN** the config contains a permission entry with tool `Bash`, pattern `curl *`, and action `deny`

#### Scenario: Claude permissions are read from both settings files
- **GIVEN** `.claude/settings.json` with `permissions.allow` of `Bash(npm test)` and `.claude/settings.local.json` with `permissions.deny` of `Read(./.env)`
- **WHEN** importing from claude
- **THEN** both entries are present, the first with action `allow` and the second with action `deny`

#### Scenario: An action-less source defaults to allow
- **WHEN** importing a permission from a source that expresses no action
- **THEN** the resulting entry has action `allow`

#### Scenario: Each action maps to its matching Claude settings key
- **GIVEN** a config holding one permission entry with action `<action>`
- **WHEN** exporting to claude
- **THEN** `.claude/settings.local.json` contains that entry under the `<key>` key

#### Examples:
| action | key   |
|--------|-------|
| allow  | allow |
| ask    | ask   |
| deny   | deny  |

### Requirement: A conversion never weakens a permission posture

A permission whose action is `deny` or `ask` SHALL NOT be emitted as an `allow` under any
circumstance. Where the target harness cannot represent that action, the entry SHALL be reported as
a `blocked` item and SHALL NOT be written in any weakened form. No flag SHALL downgrade it.

#### Scenario: A deny bound for a target with no permission model is refused, not downgraded
- **GIVEN** a config holding a permission entry with action `deny`, tool `Bash`, pattern `rm -rf *`
- **WHEN** exporting to cursor, which has no project-level permission config
- **THEN** a `blocked` item is reported naming that permission
- **AND** no file written contains that pattern as an allowed permission

#### Scenario: The rest of the conversion still completes
- **GIVEN** a config holding a `deny` permission plus rules, agents, skills, and commands
- **WHEN** exporting to cursor
- **THEN** the rule, agent, skill, and command files are still written
- **AND** the run reports exactly one `blocked` item

#### Scenario: A deny is refused for every target that cannot represent it
- **GIVEN** a config holding a permission entry with action `deny`
- **WHEN** exporting to `<target>`
- **THEN** the item status is `<status>`

#### Examples:
| target   | status  |
|----------|---------|
| claude   | exact   |
| opencode | exact   |
| cursor   | blocked |
| windsurf | blocked |
| copilot  | blocked |
| codex    | blocked |

### Requirement: OpenCode shorthand-only tools do not silently widen a deny

OpenCode represents some permission keys as a shorthand action rather than per-pattern rules. Where
collapsing patterns to a shorthand would turn a `deny` into a broader permission, the entry SHALL be
reported as `blocked` rather than collapsed.

#### Scenario: A shorthand-only tool holding a deny is refused
- **GIVEN** a config holding a permission entry with action `deny` for a tool OpenCode accepts only as shorthand
- **WHEN** exporting to opencode
- **THEN** a `blocked` item is reported naming that tool
- **AND** `opencode.json` does not grant that tool `allow`

#### Scenario: A granular tool keeps its per-pattern deny
- **GIVEN** a config holding a permission entry with action `deny`, tool `bash`, pattern `rm -rf *`
- **WHEN** exporting to opencode
- **THEN** `opencode.json` contains `permission.bash` mapping `rm -rf *` to `deny`
- **AND** the item status is `exact`

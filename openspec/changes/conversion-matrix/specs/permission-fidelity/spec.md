## ADDED Requirements

### Requirement: A permission tool name converts in a form the target matches

A `PermissionEntry.tool` SHALL be canonical — the capitalised tool name Claude Code matches, such
as `Bash`, `WebFetch`, `WebSearch` — regardless of the source harness's own casing. The OpenCode
importer, whose config keys are lowercase, SHALL map them to canonical names on import. The
OpenCode exporter already lowercases on write and SHALL keep doing so.

An entry written in a form the target does not match is a weakened posture, not a cosmetic
difference: an `ask` rule that never fires lets the command run unprompted.

#### Scenario: An OpenCode ask rule reaches Claude Code in matchable form
- **GIVEN** an `opencode.json` holding `"permission": { "bash": { "git push *": "ask" } }`
- **WHEN** converting from opencode to claude
- **THEN** `.claude/settings.local.json` holds `Bash(git push *)` under the `ask` key
- **AND** it does not hold `bash(git push *)`

#### Scenario: A bare OpenCode shorthand reaches Claude Code in matchable form
- **GIVEN** an `opencode.json` holding `"permission": { "webfetch": "allow" }`
- **WHEN** converting from opencode to claude
- **THEN** `.claude/settings.local.json` holds `WebFetch` under the `allow` key

#### Scenario: The OpenCode exporter still writes lowercase keys
- **GIVEN** a canonical config holding a `Bash` permission with pattern `npm run:*` and action
  `allow`
- **WHEN** exporting to opencode
- **THEN** the emitted `opencode.json` holds the key `bash`, not `Bash`

#### Scenario: An unmapped tool name is left alone
- **GIVEN** an `opencode.json` holding `"permission": { "external_directory": "allow" }`
- **WHEN** importing from opencode
- **THEN** the imported permission's tool is `external_directory`

### Requirement: A permission OpenCode does not write is not reported exact

`buildPermissionConfig` omits `WebSearch` from the emitted `opencode.json`, because OpenCode has no
such permission key. Such an entry SHALL be reported through the same never-weaken rule as any
other unrepresentable permission: `dropped` when the action is `allow`, `blocked` when it is `ask`
or `deny`. It SHALL NOT be reported `exact`.

#### Scenario: An allowed WebSearch is reported dropped
- **GIVEN** a canonical config holding a `WebSearch` permission with pattern `*` and action `allow`
- **WHEN** exporting to opencode
- **THEN** the `permission` item named `WebSearch(*)` has status `dropped`
- **AND** the emitted `opencode.json` has no `websearch` permission key

#### Scenario: A denied WebSearch is blocked rather than discarded
- **GIVEN** a canonical config holding a `WebSearch` permission with pattern `*` and action `deny`
- **WHEN** exporting to opencode
- **THEN** the `permission` item named `WebSearch(*)` has status `blocked`

#### Scenario: A denied WebSearch fails the run
- **GIVEN** a source config holding a `WebSearch` deny rule
- **WHEN** converting to opencode
- **THEN** the process exits `2`

#### Scenario: WebFetch is unaffected
- **GIVEN** a canonical config holding a `WebFetch` permission with pattern `*` and action `allow`
- **WHEN** exporting to opencode
- **THEN** the emitted `opencode.json` holds a `webfetch` permission key
- **AND** the `permission` item named `WebFetch(*)` has status `exact`

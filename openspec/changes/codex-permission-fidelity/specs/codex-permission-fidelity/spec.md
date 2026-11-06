# Delta for codex-permission-fidelity

Evidence key: S = openai/codex `codex-rs/core/config.schema.json`; E = `codex-rs/execpolicy/README.md`; D = `codex-rs/hooks/src/engine/discovery.rs`. Docs site was unreachable.

## ADDED Requirements

### Requirement: Codex permission reports name prefix rules and the unverified path
The system SHALL report a Codex-target permission entry that it does not write with a reason that names `prefix_rule` (E) and states the rules file path is UNVERIFIED. The reason SHALL NOT state that Codex has no permission config. The system SHALL write no permission file for Codex.

#### Scenario: A deny is blocked with an accurate reason
- **GIVEN** a config with permission `Bash(rm -rf *)` action `deny`
- **WHEN** it is exported to Codex
- **THEN** the item has status `blocked`
- **AND** the reason contains `prefix_rule` and `UNVERIFIED`
- **AND** the reason does not contain `no project-level permission config`
- **AND** no file under the target contains `rm -rf *`

#### Scenario: An allow is dropped with an accurate reason
- **GIVEN** a config with permission `Bash(ls *)` action `allow`
- **WHEN** it is exported to Codex
- **THEN** the item has status `dropped`
- **AND** the reason contains `prefix_rule` and `UNVERIFIED`

### Requirement: A hook timeout is written and reported lossy with an unverified unit
The system SHALL write a hook's `timeout` as the `timeout` field of the Codex command handler (S) and report the hook `lossy` with a reason that says the unit is UNVERIFIED.

#### Scenario: A hook with a timeout
- **GIVEN** a `PostToolUse` hook with matcher `Bash` and timeout 30
- **WHEN** it is exported to Codex
- **THEN** `.codex/hooks.json` holds a command handler with `timeout` 30
- **AND** the hook item has status `lossy`
- **AND** the reason contains `UNVERIFIED` and does not contain `no verified hook timeout field`

#### Scenario: A hook without a timeout
- **GIVEN** a `PostToolUse` hook with matcher `Bash` and no timeout
- **WHEN** it is exported to Codex
- **THEN** the handler has no `timeout` key
- **AND** the hook item has status `exact`

### Requirement: The fail-closed limitation is marked unverified
The system SHALL report a hook with `failClosed` as not written, with a reason that says the absence of a Codex fail-closed field is UNVERIFIED.

#### Scenario: A fail-closed guardrail
- **GIVEN** a `PreToolUse` hook with matcher `Bash` and `failClosed` true
- **WHEN** it is exported to Codex
- **THEN** the item has status `blocked`
- **AND** the reason contains `UNVERIFIED`
- **AND** `.codex/hooks.json` is not written

### Requirement: The hooks file keeps the matcher-group shape
The system SHALL write Codex hooks to `.codex/hooks.json` as `{"hooks": {"<Event>": [{"matcher"?, "hooks": [{"type": "command", "command"}]}]}}` (D for the file name, S for the matcher group).

#### Scenario: A Bash hook
- **GIVEN** a `PreToolUse` hook with matcher `Bash` and command `./g.sh`
- **WHEN** it is exported to Codex
- **THEN** `hooks.PreToolUse[0].matcher` is `Bash`
- **AND** `hooks.PreToolUse[0].hooks[0]` equals `{"type":"command","command":"./g.sh"}`

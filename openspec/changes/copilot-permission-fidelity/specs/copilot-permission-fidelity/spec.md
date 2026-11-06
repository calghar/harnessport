## ADDED Requirements

### Requirement: Copilot permission reasons name the user-level files
The Copilot exporter SHALL keep every permission entry unwritten, SHALL report an `allow` as `dropped` and a `deny` or `ask` as `blocked`, and SHALL state in the reason that the Copilot CLI keeps permissions in user-level files under `~/.copilot` that harnessport does not write.

#### Scenario: An allow is dropped with the user-level reason
- **GIVEN** a canonical permission with tool `Bash`, pattern `npm test`, action `allow`
- **WHEN** the Copilot exporter exports the config into an empty project
- **THEN** the item for `Bash(npm test)` has status `dropped`
- **AND** its reason contains `~/.copilot/permissions-config.json`
- **AND** its reason contains `never writes`
- **AND** no file under `.github/copilot` is written

#### Scenario: A deny is blocked with the user-level reason
- **GIVEN** a canonical permission with tool `Bash`, pattern `rm *`, action `deny`
- **WHEN** the Copilot exporter exports the config into an empty project
- **THEN** the item for `Bash(rm *)` has status `blocked`
- **AND** its reason contains `~/.copilot/settings.json`

### Requirement: Copilot hook reasons match the documented events and failure modes
The Copilot exporter SHALL report a `PermissionRequest` guardrail as `blocked` with a reason that says the Copilot CLI has a `permissionRequest` event that is not mapped and Copilot cloud has none. It SHALL report a `failClosed` `PreToolUse` guardrail as `blocked` with a reason that says a non-zero exit blocks, exit `2` denies, and a timeout fails open. It SHALL report a `failClosed` hook on any other event as `lossy` with a reason that says the run continues when the hook fails.

#### Scenario: A PermissionRequest guardrail names both surfaces
- **GIVEN** a canonical hook with event `PermissionRequest` and command `./perm.sh`
- **WHEN** the Copilot exporter exports the config into an empty project
- **THEN** the item for `PermissionRequest` has status `blocked`
- **AND** its reason contains `permissionRequest`
- **AND** its reason contains `cloud`
- **AND** its reason does not contain `has no permission-request hook event`

#### Scenario: A failClosed PreToolUse guardrail states the real failure modes
- **GIVEN** a canonical hook with event `PreToolUse`, command `./guard.sh` and `failClosed` true
- **WHEN** the Copilot exporter exports the config into an empty project
- **THEN** the item for `PreToolUse` has status `blocked`
- **AND** its reason contains `exit 2`
- **AND** its reason contains `timeout`
- **AND** its reason does not contain `cannot make a failing hook block the action`

#### Scenario: A failClosed non-guardrail hook is lossy and fail-open
- **GIVEN** a canonical hook with event `PostToolUse`, command `./after.sh` and `failClosed` true
- **WHEN** the Copilot exporter exports the config into an empty project
- **THEN** the item for `PostToolUse` has status `lossy`
- **AND** its reason contains `fail-open`

### Requirement: Copilot project MCP lives in .github/mcp.json
The Copilot exporter SHALL write project MCP servers to `.github/mcp.json`. The Copilot importer and detector SHALL read that file. Neither SHALL use `.copilot/mcp-config.json`.

#### Scenario: Export then import round-trips through .github/mcp.json
- **GIVEN** a canonical MCP server `fs` of type stdio with command `npx`
- **WHEN** the Copilot exporter exports the config into a temp directory and the Copilot importer reads that directory
- **THEN** `.github/mcp.json` exists and holds `fs` under `mcpServers`
- **AND** `.copilot/mcp-config.json` does not exist
- **AND** the imported MCP servers hold `fs`

#### Scenario: A directory holding only .github/mcp.json is detected
- **GIVEN** a directory holding only `.github/mcp.json`
- **WHEN** the Copilot detector runs on it
- **THEN** it reports the directory as a Copilot project

Feature: copilot-permission-fidelity

  # Requirement: Copilot permission reasons name the user-level files
  # The Copilot exporter SHALL keep every permission entry unwritten, SHALL report an `allow` as `dropped` and a `deny` or `ask` as `blocked`, and SHALL state in the reason that the Copilot CLI keeps permissions in user-level files under `~/.copilot` that harnessport does not write.

  @requirement_copilot_permission_reasons_name_the_user_level_files
  Scenario: An allow is dropped with the user-level reason
    Given a canonical permission with tool `Bash`, pattern `npm test`, action `allow`
    When the Copilot exporter exports the config into an empty project
    Then the item for `Bash(npm test)` has status `dropped`
    And its reason contains `~/.copilot/permissions-config.json`
    And its reason contains `never writes`
    And no file under `.github/copilot` is written

  @requirement_copilot_permission_reasons_name_the_user_level_files
  Scenario: A deny is blocked with the user-level reason
    Given a canonical permission with tool `Bash`, pattern `rm *`, action `deny`
    When the Copilot exporter exports the config into an empty project
    Then the item for `Bash(rm *)` has status `blocked`
    And its reason contains `~/.copilot/settings.json`

  # Requirement: Copilot hook reasons match the documented events and failure modes
  # The Copilot exporter SHALL report a `PermissionRequest` guardrail as `blocked` with a reason that says the Copilot CLI has a `permissionRequest` event that is not mapped and Copilot cloud has none. It SHALL report a `failClosed` `PreToolUse` guardrail as `blocked` with a reason that says a non-zero exit blocks, exit `2` denies, and a timeout fails open. It SHALL report a `failClosed` hook on any other event as `lossy` with a reason that says the run continues when the hook fails.

  @requirement_copilot_hook_reasons_match_the_documented_events_and_failure_modes
  Scenario: A PermissionRequest guardrail names both surfaces
    Given a canonical hook with event `PermissionRequest` and command `./perm.sh`
    When the Copilot exporter exports the config into an empty project
    Then the item for `PermissionRequest` has status `blocked`
    And its reason contains `permissionRequest`
    And its reason contains `cloud`
    And its reason does not contain `has no permission-request hook event`

  @requirement_copilot_hook_reasons_match_the_documented_events_and_failure_modes
  Scenario: A failClosed PreToolUse guardrail states the real failure modes
    Given a canonical hook with event `PreToolUse`, command `./guard.sh` and `failClosed` true
    When the Copilot exporter exports the config into an empty project
    Then the item for `PreToolUse` has status `blocked`
    And its reason contains `exit 2`
    And its reason contains `timeout`
    And its reason does not contain `cannot make a failing hook block the action`

  @requirement_copilot_hook_reasons_match_the_documented_events_and_failure_modes
  Scenario: A failClosed non-guardrail hook is lossy and fail-open
    Given a canonical hook with event `PostToolUse`, command `./after.sh` and `failClosed` true
    When the Copilot exporter exports the config into an empty project
    Then the item for `PostToolUse` has status `lossy`
    And its reason contains `fail-open`

  # Requirement: Copilot project MCP lives in .github/mcp.json
  # The Copilot exporter SHALL write project MCP servers to `.github/mcp.json`. The Copilot importer and detector SHALL read that file. Neither SHALL use `.copilot/mcp-config.json`.

  @requirement_copilot_project_mcp_lives_in_github_mcp_json
  Scenario: Export then import round-trips through .github/mcp.json
    Given a canonical MCP server `fs` of type stdio with command `npx`
    When the Copilot exporter exports the config into a temp directory and the Copilot importer reads that directory
    Then `.github/mcp.json` exists and holds `fs` under `mcpServers`
    And `.copilot/mcp-config.json` does not exist
    And the imported MCP servers hold `fs`

  @requirement_copilot_project_mcp_lives_in_github_mcp_json
  Scenario: A directory holding only .github/mcp.json is detected
    Given a directory holding only `.github/mcp.json`
    When the Copilot detector runs on it
    Then it reports the directory as a Copilot project

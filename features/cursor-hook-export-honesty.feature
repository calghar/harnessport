Feature: cursor-hook-export-honesty

  # Requirement: A refused hooks.json never reports a guardrail as written
  # The Cursor exporter SHALL report each PreToolUse hook item as `blocked`, with a reason, when the write of `.cursor/hooks.json` is refused, and the CLI SHALL exit with code 2.

  @requirement_a_refused_hooks_json_never_reports_a_guardrail_as_written
  Scenario: A refused hooks.json blocks the guardrail and exits 2
    Given an existing `.cursor/hooks.json` with content `{"version":1,"hooks":{"afterFileEdit":[{"command":"./audit.sh"}]}}`
    When a Claude project with one PreToolUse guardrail (Bash, command `./guard.sh`) is converted to Cursor without `--force`
    Then the item for the guardrail (kind `hook`, name `PreToolUse`) has status `blocked` with a non-empty reason
    And `.cursor/hooks.json` keeps its content
    And the process exits with code 2

  # Requirement: A successful hooks.json write keeps its hook status
  # The Cursor exporter SHALL report a PreToolUse hook item as `exact` or `lossy`, as determined by its matcher, when `.cursor/hooks.json` is written.

  @requirement_a_successful_hooks_json_write_keeps_its_hook_status
  Scenario: A written hooks.json keeps the exact status
    Given no `.cursor/hooks.json` in the target
    When a Claude project with one PreToolUse guardrail (Bash, command `./guard.sh`) is converted to Cursor
    Then the item for the guardrail has status `exact`
    And `.cursor/hooks.json` holds one `preToolUse` entry
    And the process exits with code 0

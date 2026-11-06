Feature: cursor-native-hooks

  # Requirement: A Read or Write guardrail that Cursor runs natively is not wrapped
  # A `PreToolUse` hook of dialect `claude` whose matcher tokens all map to Cursor `Read` or `Write` (Claude `Read`, `Write`, `Edit`, `MultiEdit`) SHALL get no wrapper file and no `.cursor/hooks.json` entry. Its item of kind `hook` SHALL be `lossy`, with a reason stating that Cursor runs the hook from `.claude/settings.json` when its Third-Party Imports setting is on, so nothing is written, and that the hook does not run when that setting is off. A hook whose matcher has a `Bash` token, or has no matcher or `*`, SHALL be exported exactly as without this requirement. Wrappers are numbered over written wrappers only.

  @requirement_a_read_or_write_guardrail_that_cursor_runs_natively_is_not_wrapped
  Scenario: A Read and Write guardrail writes nothing and is lossy
    Given a canonical config holding a hook `{event: "PreToolUse", matcher: "Read|Write", command: "./guard.sh"}`
    When converting from claude to cursor into a new directory
    Then no file `.cursor/hooks.json` is written
    And no file `.cursor/hooks/harnessport-guard-1.mjs` is written
    And the item of kind `hook` named `PreToolUse` has status `lossy` and its reason names `Third-Party Imports`
    And the item of kind `hook` named `PreToolUse` has status `lossy` and its reason names `does not run`

  @requirement_a_read_or_write_guardrail_that_cursor_runs_natively_is_not_wrapped
  Scenario: A Bash guardrail keeps its wrapper
    Given a canonical config holding a hook `{event: "PreToolUse", matcher: "Bash", command: "./guard.sh"}`
    When converting from claude to cursor into a new directory
    Then the file `.cursor/hooks/harnessport-guard-1.mjs` exists and contains the string `./guard.sh`
    And the item of kind `hook` named `PreToolUse` has status `exact` and its reason names `node`

  @requirement_a_read_or_write_guardrail_that_cursor_runs_natively_is_not_wrapped
  Scenario: A hook without a matcher keeps its wrapper
    Given a canonical config holding a hook `{event: "PreToolUse", command: "./guard.sh"}`
    When converting from claude to cursor into a new directory
    Then `hooks.preToolUse[0].matcher` equals `*`
    And the file `.cursor/hooks/harnessport-guard-1.mjs` exists and contains the string `./guard.sh`

  # Requirement: A Read guardrail is reported lossy because Cursor drops offset and limit
  # The item of a `PreToolUse` hook whose matcher includes `Read`, whether wrapped or not written, SHALL be `lossy`, with a reason stating that Cursor does not pass `offset` or `limit` to hooks, so a hook that allows ranged reads sees every read as a full read.

  @requirement_a_read_guardrail_is_reported_lossy_because_cursor_drops_offset_and_limit
  Scenario: A wrapped Bash and Read guardrail is lossy
    Given a canonical config holding a hook `{event: "PreToolUse", matcher: "Bash|Read", command: "./guard.sh"}`
    When converting from claude to cursor into a new directory
    Then `hooks.preToolUse[0].matcher` equals `Shell|Read`
    And the file `.cursor/hooks/harnessport-guard-1.mjs` exists and contains the string `./guard.sh`
    And the item of kind `hook` named `PreToolUse` has status `lossy` and its reason names `offset or limit`

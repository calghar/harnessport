Feature: cursor-native-hooks

  # Requirement: A Read or Write guardrail is wrapped on its Cursor event
  # A `PreToolUse` hook of dialect `claude` whose matcher has a `Read` token SHALL get a wrapper registered under `beforeReadFile`. Its `Write`, `Edit` and `MultiEdit` tokens SHALL map to a `preToolUse` wrapper with matcher `Write`. A matcher mixing tokens SHALL write one wrapper per Cursor event it needs, numbered over written wrappers in config order, and carry `timeout` and `failClosed` to each. The hook SHALL yield one item of kind `hook`. A hook whose matcher has no `Read` token and a `Bash` token, or has no matcher or `*`, SHALL be exported as before.

  @requirement_a_read_or_write_guardrail_is_wrapped_on_its_cursor_event
  Scenario: A Read and Write guardrail writes one wrapper per event
    Given a canonical config holding a hook `{event: "PreToolUse", matcher: "Read|Write", command: "./guard.sh"}`
    When converting from claude to cursor into a new directory
    Then `.cursor/hooks.json` equals `{version: 1, hooks: {preToolUse: [{command: "node .cursor/hooks/harnessport-guard-1.mjs", matcher: "Write"}], beforeReadFile: [{command: "node .cursor/hooks/harnessport-guard-2.mjs"}]}}`
    And the file `.cursor/hooks/harnessport-guard-2.mjs` exists and contains the string `./guard.sh`
    And the item of kind `hook` named `PreToolUse` has status `lossy` and its reason names `content line count`

  @requirement_a_read_or_write_guardrail_is_wrapped_on_its_cursor_event
  Scenario: A Bash guardrail keeps its wrapper
    Given a canonical config holding a hook `{event: "PreToolUse", matcher: "Bash", command: "./guard.sh"}`
    When converting from claude to cursor into a new directory
    Then the file `.cursor/hooks/harnessport-guard-1.mjs` exists and contains the string `./guard.sh`
    And the item of kind `hook` named `PreToolUse` has status `exact` and its reason names `node`

  @requirement_a_read_or_write_guardrail_is_wrapped_on_its_cursor_event
  Scenario: A hook without a matcher keeps its wrapper
    Given a canonical config holding a hook `{event: "PreToolUse", command: "./guard.sh"}`
    When converting from claude to cursor into a new directory
    Then `hooks.preToolUse[0].matcher` equals `*`
    And the file `.cursor/hooks/harnessport-guard-1.mjs` exists and contains the string `./guard.sh`

  # Requirement: A Read guardrail recovers the read range from the content line count
  # The wrapper of a `beforeReadFile` hook SHALL send the Claude hook `tool_name` `Read` and `tool_input.file_path`. When the payload `content` has fewer lines than the file at `file_path`, it SHALL also send `tool_input.limit` equal to the content line count. With equal counts or an unreadable file it SHALL send no `limit`. The item of the hook SHALL be `lossy`, with a reason stating that the range is recovered from the content line count and unverified in Cursor.

  @requirement_a_read_guardrail_recovers_the_read_range_from_the_content_line_count
  Scenario: A Bash and Read guardrail writes a shell wrapper and a read wrapper
    Given a canonical config holding a hook `{event: "PreToolUse", matcher: "Bash|Read", command: "./guard.sh"}`
    When converting from claude to cursor into a new directory
    Then `.cursor/hooks.json` equals `{version: 1, hooks: {beforeShellExecution: [{command: "node .cursor/hooks/harnessport-guard-1.mjs"}], beforeReadFile: [{command: "node .cursor/hooks/harnessport-guard-2.mjs"}]}}`
    And the item of kind `hook` named `PreToolUse` has status `lossy` and its reason names `content line count`

  # Requirement: Other Claude hook events are wrapped on their Cursor events
  # A hook of event `SessionStart`, `SessionEnd`, `Stop`, `SubagentStart`, `SubagentStop`, `PreCompact`, `UserPromptSubmit`, `PostToolUse` or `PostToolUseFailure` SHALL get a wrapper registered under `sessionStart`, `sessionEnd`, `stop`, `subagentStart`, `subagentStop`, `preCompact`, `beforeSubmitPrompt`, `postToolUse` or `postToolUseFailure`. A `PostToolUse` or `PostToolUseFailure` matcher SHALL map to Cursor tool names, and a `SubagentStart` or `SubagentStop` matcher SHALL pass unchanged. No other event gets a matcher. A `PreCompact` hook with `failClosed` SHALL be `blocked` and not written. `Notification` SHALL be `dropped` and `PermissionRequest` SHALL be `blocked`. Each written item names Third-Party Imports.

  @requirement_other_claude_hook_events_are_wrapped_on_their_cursor_events
  Scenario: SessionStart is written under sessionStart
    Given a canonical config holding a hook `{event: "SessionStart", command: "./h.sh"}`
    When converting from claude to cursor into a new directory
    Then `.cursor/hooks.json` equals `{version: 1, hooks: {sessionStart: [{command: "node .cursor/hooks/harnessport-guard-1.mjs"}]}}`
    And the item of kind `hook` named `SessionStart` has status `lossy` and its reason names `additional_context`
    And the item of kind `hook` named `SessionStart` has status `lossy` and its reason names `Third-Party Imports`

  @requirement_other_claude_hook_events_are_wrapped_on_their_cursor_events
  Scenario: SessionEnd is written under sessionEnd
    Given a canonical config holding a hook `{event: "SessionEnd", command: "./h.sh"}`
    When converting from claude to cursor into a new directory
    Then `.cursor/hooks.json` equals `{version: 1, hooks: {sessionEnd: [{command: "node .cursor/hooks/harnessport-guard-1.mjs"}]}}`
    And the item of kind `hook` named `SessionEnd` has status `exact` and its reason names `node`
    And the item of kind `hook` named `SessionEnd` has status `exact` and its reason names `Third-Party Imports`

  @requirement_other_claude_hook_events_are_wrapped_on_their_cursor_events
  Scenario: Stop is written under stop
    Given a canonical config holding a hook `{event: "Stop", command: "./h.sh"}`
    When converting from claude to cursor into a new directory
    Then `.cursor/hooks.json` equals `{version: 1, hooks: {stop: [{command: "node .cursor/hooks/harnessport-guard-1.mjs"}]}}`
    And the item of kind `hook` named `Stop` has status `lossy` and its reason names `loop_limit`
    And the item of kind `hook` named `Stop` has status `lossy` and its reason names `Third-Party Imports`

  @requirement_other_claude_hook_events_are_wrapped_on_their_cursor_events
  Scenario: SubagentStart is written under subagentStart
    Given a canonical config holding a hook `{event: "SubagentStart", command: "./h.sh"}`
    When converting from claude to cursor into a new directory
    Then `.cursor/hooks.json` equals `{version: 1, hooks: {subagentStart: [{command: "node .cursor/hooks/harnessport-guard-1.mjs"}]}}`
    And the item of kind `hook` named `SubagentStart` has status `exact` and its reason names `node`
    And the item of kind `hook` named `SubagentStart` has status `exact` and its reason names `Third-Party Imports`

  @requirement_other_claude_hook_events_are_wrapped_on_their_cursor_events
  Scenario: SubagentStop is written under subagentStop
    Given a canonical config holding a hook `{event: "SubagentStop", command: "./h.sh"}`
    When converting from claude to cursor into a new directory
    Then `.cursor/hooks.json` equals `{version: 1, hooks: {subagentStop: [{command: "node .cursor/hooks/harnessport-guard-1.mjs"}]}}`
    And the item of kind `hook` named `SubagentStop` has status `lossy` and its reason names `loop_limit`
    And the item of kind `hook` named `SubagentStop` has status `lossy` and its reason names `Third-Party Imports`

  @requirement_other_claude_hook_events_are_wrapped_on_their_cursor_events
  Scenario: PreCompact is written under preCompact
    Given a canonical config holding a hook `{event: "PreCompact", command: "./h.sh"}`
    When converting from claude to cursor into a new directory
    Then `.cursor/hooks.json` equals `{version: 1, hooks: {preCompact: [{command: "node .cursor/hooks/harnessport-guard-1.mjs"}]}}`
    And the item of kind `hook` named `PreCompact` has status `lossy` and its reason names `observer`
    And the item of kind `hook` named `PreCompact` has status `lossy` and its reason names `Third-Party Imports`

  @requirement_other_claude_hook_events_are_wrapped_on_their_cursor_events
  Scenario: UserPromptSubmit is written under beforeSubmitPrompt
    Given a canonical config holding a hook `{event: "UserPromptSubmit", command: "./h.sh"}`
    When converting from claude to cursor into a new directory
    Then `.cursor/hooks.json` equals `{version: 1, hooks: {beforeSubmitPrompt: [{command: "node .cursor/hooks/harnessport-guard-1.mjs"}]}}`
    And the item of kind `hook` named `UserPromptSubmit` has status `lossy` and its reason names `cannot add context`
    And the item of kind `hook` named `UserPromptSubmit` has status `lossy` and its reason names `Third-Party Imports`

  @requirement_other_claude_hook_events_are_wrapped_on_their_cursor_events
  Scenario: PostToolUse is written under postToolUse
    Given a canonical config holding a hook `{event: "PostToolUse", matcher: "Bash", command: "./h.sh"}`
    When converting from claude to cursor into a new directory
    Then `.cursor/hooks.json` equals `{version: 1, hooks: {postToolUse: [{command: "node .cursor/hooks/harnessport-guard-1.mjs", matcher: "Shell"}]}}`
    And the item of kind `hook` named `PostToolUse` has status `lossy` and its reason names `cannot block`
    And the item of kind `hook` named `PostToolUse` has status `lossy` and its reason names `Third-Party Imports`

  @requirement_other_claude_hook_events_are_wrapped_on_their_cursor_events
  Scenario: PostToolUseFailure is written under postToolUseFailure
    Given a canonical config holding a hook `{event: "PostToolUseFailure", matcher: "Bash", command: "./h.sh"}`
    When converting from claude to cursor into a new directory
    Then `.cursor/hooks.json` equals `{version: 1, hooks: {postToolUseFailure: [{command: "node .cursor/hooks/harnessport-guard-1.mjs", matcher: "Shell"}]}}`
    And the item of kind `hook` named `PostToolUseFailure` has status `lossy` and its reason names `cannot block`
    And the item of kind `hook` named `PostToolUseFailure` has status `lossy` and its reason names `Third-Party Imports`

  @requirement_other_claude_hook_events_are_wrapped_on_their_cursor_events
  Scenario: A blocking PreCompact hook is blocked
    Given a canonical config holding a hook `{event: "PreCompact", command: "./h.sh", failClosed: true}`
    When converting from claude to cursor into a new directory
    Then no file `.cursor/hooks.json` is written
    And the item of kind `hook` named `PreCompact` has status `blocked` and its reason names `cannot block`

  @requirement_other_claude_hook_events_are_wrapped_on_their_cursor_events
  Scenario: A UserPromptSubmit deny stops the prompt
    Given a `UserPromptSubmit` wrapper generated for a command that exits `2`, prints `` to stdout and `no secrets` to stderr
    When the wrapper is run with stdin `{"hook_event_name": "beforeSubmitPrompt", "prompt": "x"}`
    Then the wrapper stdout parses to `{"continue": false, "user_message": "no secrets"}` and the wrapper exits `0`

  @requirement_other_claude_hook_events_are_wrapped_on_their_cursor_events
  Scenario: A UserPromptSubmit allow continues
    Given a `UserPromptSubmit` wrapper generated for a command that exits `0`, prints `` to stdout and `` to stderr
    When the wrapper is run with stdin `{"hook_event_name": "beforeSubmitPrompt", "prompt": "x"}`
    Then the wrapper stdout parses to `{"continue": true}` and the wrapper exits `0`

  @requirement_other_claude_hook_events_are_wrapped_on_their_cursor_events
  Scenario: SessionStart context becomes additional_context
    Given a `SessionStart` wrapper generated for a command that exits `0`, prints `{"hookSpecificOutput":{"additionalContext":"hello"}}` to stdout and `` to stderr
    When the wrapper is run with stdin `{"hook_event_name": "sessionStart"}`
    Then the wrapper stdout parses to `{"additional_context": "hello"}` and the wrapper exits `0`

  @requirement_other_claude_hook_events_are_wrapped_on_their_cursor_events
  Scenario: A PostToolUse payload reaches the command with the Claude field names
    Given a `PostToolUse` wrapper generated for a command that writes its stdin to `seen.json`
    When the wrapper is run with stdin `{"hook_event_name": "postToolUse", "tool_name": "Shell", "tool_output": "x"}`
    Then `seen.json` holds `tool_name` equal to `Bash`
    And `seen.json` holds `tool_response` equal to `x`
    And `seen.json` holds `hook_event_name` equal to `PostToolUse`

  @requirement_other_claude_hook_events_are_wrapped_on_their_cursor_events
  Scenario: A Stop block becomes a follow-up message
    Given a `Stop` wrapper generated for a command that exits `0`, prints `{"decision":"block","reason":"keep going"}` to stdout and `` to stderr
    When the wrapper is run with stdin `{"hook_event_name": "stop"}`
    Then the wrapper stdout parses to `{"followup_message": "keep going"}` and the wrapper exits `0`

  @requirement_other_claude_hook_events_are_wrapped_on_their_cursor_events
  Scenario: A SubagentStart deny blocks the subagent
    Given a `SubagentStart` wrapper generated for a command that exits `2`, prints `` to stdout and `` to stderr
    When the wrapper is run with stdin `{"hook_event_name": "subagentStart"}`
    Then the wrapper stdout parses to `{"permission": "deny", "user_message": "blocked by hook"}` and the wrapper exits `0`

  @requirement_other_claude_hook_events_are_wrapped_on_their_cursor_events
  Scenario: SessionEnd and PreCompact print nothing
    Given a `SessionEnd` wrapper generated for a command that exits `0`, prints `` to stdout and `` to stderr
    When the wrapper is run with stdin `{"hook_event_name": "sessionEnd"}`
    Then the wrapper exits `0` and prints nothing on stdout

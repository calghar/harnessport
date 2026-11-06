## ADDED Requirements

### Requirement: Claude guardrails export to Cursor through a generated Node wrapper

For each `PreToolUse` hook of dialect `claude`, the Cursor exporter SHALL write one wrapper file
`.cursor/hooks/harnessport-guard-<n>.mjs`, where `<n>` counts written wrappers from `1` in config
order. It SHALL write `.cursor/hooks.json` as `{version: 1, hooks: {preToolUse: [<entry>]}}`. Each
entry is `{command: "node .cursor/hooks/harnessport-guard-<n>.mjs", matcher, timeout?, failClosed?}`.
`timeout` equals the hook `timeout` in seconds. `failClosed: true` is written only when the hook has
`failClosed: true`. The item of kind `hook` names `PreToolUse`, and its reason states that the wrapper
needs `node` on `PATH`. The Cursor exporter SHALL NOT write `.claude/settings.json`. An existing
`.cursor/hooks.json` or `.claude/hooks/harnessport-format.mjs` with different content SHALL be
reported `blocked` unless `--force` is given. A `harnessport-guard-<n>.mjs` file with `<n>` above the
written count SHALL be named in the item reason.

#### Scenario: A claude Bash guardrail becomes a Cursor preToolUse Shell entry
- **GIVEN** a canonical config holding a hook `{event: "PreToolUse", matcher: "Bash", command: "./guard.sh", timeout: 10, failClosed: true}`
- **WHEN** converting from claude to cursor into a new directory
- **THEN** `.cursor/hooks.json` equals `{version: 1, hooks: {preToolUse: [{command: "node .cursor/hooks/harnessport-guard-1.mjs", matcher: "Shell", timeout: 10, failClosed: true}]}}`
- **AND** the file `.cursor/hooks/harnessport-guard-1.mjs` exists and contains the string `./guard.sh`
- **AND** the item of kind `hook` named `PreToolUse` has status `exact` and its reason names `node`
- **AND** no file `.claude/settings.json` is written

#### Scenario: A user-level target writes absolute wrapper paths
- **GIVEN** a canonical config holding a hook `{event: "PreToolUse", matcher: "Bash", command: "./guard.sh"}` and a home directory passed to the exporter
- **WHEN** converting from claude to cursor with the target equal to that home directory
- **THEN** `hooks.preToolUse[0].command` in `.cursor/hooks.json` equals `node "<absolute path>/.cursor/hooks/harnessport-guard-1.mjs"`, with the path in double quotes
- **AND** converting into any other directory still writes `node .cursor/hooks/harnessport-guard-1.mjs`

#### Scenario: A guardrail without failClosed gets no failClosed key
- **GIVEN** a canonical config holding a hook `{event: "PreToolUse", matcher: "Bash", command: "./guard.sh"}`
- **WHEN** converting from claude to cursor into a new directory
- **THEN** `hooks.preToolUse[0]` in `.cursor/hooks.json` has no `failClosed` key and no `timeout` key

#### Scenario: Re-running the conversion is idempotent
- **GIVEN** a directory where converting from claude to cursor has already run
- **WHEN** the same conversion runs again
- **THEN** `.cursor/hooks.json` and every wrapper file are byte-identical
- **AND** no item has status `blocked`

#### Scenario: A user-authored .cursor/hooks.json is blocked without force
- **GIVEN** a target directory holding a `.cursor/hooks.json` whose content differs from what the export would write
- **WHEN** converting from claude to cursor into that directory without `--force`
- **THEN** the file is byte-identical to its content before the run
- **AND** an item names `.cursor/hooks.json` with status `blocked`

#### Scenario: Cursor formatters stay dropped
- **GIVEN** a canonical config holding one formatter
- **WHEN** converting from claude to cursor
- **THEN** the item of kind `formatter` has status `dropped`

### Requirement: Cursor matchers and events are mapped or reported

The Cursor exporter SHALL map each `|` token of a guardrail matcher as follows: `Bash` to `Shell`,
`Read` to `Read`, `Write` to `Write`, `Grep` to `Grep`, `Edit` and `MultiEdit` to `Write`. Duplicate
results are written once. A matcher of `*`, empty or absent maps to `*`. An `Edit` or `MultiEdit`
token SHALL make the item `lossy`, with a reason stating that Cursor `Write` covers both creates and
edits. A `*` matcher SHALL make the item `lossy`, with a reason stating that Cursor tool names other
than `Shell` reach the script unrenamed. Any other token, and any matcher other than a lone `*`
that contains a character outside letters, digits, `_` and `|`, SHALL make the item `blocked`, with a reason naming the token.
If any matcher token is unmapped, the item is `blocked` and no `lossy` reason is added. An empty or
absent matcher is `lossy` under the `*` reason.
A `PermissionRequest` or `UserPromptSubmit` guardrail SHALL be reported `blocked`. A non-guardrail
hook SHALL be reported `dropped`, with the reason: "Cursor runs this hook only if
`.claude/settings.json` holds it and Third-Party Imports is on."

#### Scenario: An Edit|Write matcher becomes Write and is lossy
- **GIVEN** a canonical config holding a hook `{event: "PreToolUse", matcher: "Edit|Write", command: "./guard.sh"}`
- **WHEN** converting from claude to cursor into a new directory
- **THEN** `hooks.preToolUse[0].matcher` equals `Write`
- **AND** the item of kind `hook` named `PreToolUse` has status `lossy` and its reason names creates and edits

#### Scenario: A regex matcher is blocked
- **GIVEN** a canonical config holding a hook `{event: "PreToolUse", matcher: "Bash.*", command: "./guard.sh"}`
- **WHEN** converting from claude to cursor
- **THEN** the item of kind `hook` named `PreToolUse` has status `blocked`
- **AND** no wrapper file is written for it
- **AND** the process exits `2`

#### Scenario: An MCP matcher is blocked
- **GIVEN** a canonical config holding a hook `{event: "PreToolUse", matcher: "mcp__github__create_issue", command: "./guard.sh"}`
- **WHEN** converting from claude to cursor
- **THEN** the item of kind `hook` named `PreToolUse` has status `blocked` and its reason names `mcp__github__create_issue`

#### Scenario: A PermissionRequest guardrail is blocked
- **GIVEN** a canonical config holding a hook `{event: "PermissionRequest", command: "./perm.sh"}`
- **WHEN** converting from claude to cursor
- **THEN** the item of kind `hook` named `PermissionRequest` has status `blocked`

#### Scenario: A UserPromptSubmit guardrail is blocked
- **GIVEN** a canonical config holding a hook `{event: "UserPromptSubmit", command: "./prompt.sh"}`
- **WHEN** converting from claude to cursor
- **THEN** the item of kind `hook` named `UserPromptSubmit` has status `blocked`

#### Scenario: A PostToolUse hook is dropped
- **GIVEN** a canonical config holding a hook `{event: "PostToolUse", matcher: "Bash", command: "./log.sh"}`
- **WHEN** converting from claude to cursor
- **THEN** the item of kind `hook` named `PostToolUse` has status `dropped` and its reason names Third-Party Imports
- **AND** the process exits `0`

#### Scenario: A copilot PostToolUse hook exported to cursor is dropped with a Claude-source reason
- **GIVEN** a canonical config holding a hook `{event: "PostToolUse", command: "./log.sh", dialect: "copilot"}`
- **WHEN** converting from copilot to cursor
- **THEN** the item of kind `hook` named `PostToolUse` has status `dropped`
- **AND** its reason names `.claude/settings.json`

### Requirement: The wrapper renames `Shell` to `Bash`

The wrapper SHALL read Cursor's stdin JSON, replace `tool_name` `Shell` with `Bash`, and leave every
other field unchanged. It SHALL run the original command with that JSON on stdin, from the wrapper's
working directory, with the inherited environment. A hook with `args` runs as `command` plus `args`
without a shell. A hook without `args` runs `command` through the platform shell.

#### Scenario: Shell is renamed to Bash
- **GIVEN** a wrapper generated for a command that writes its stdin to `seen.json`
- **WHEN** the wrapper is run with stdin `{"tool_name": "Shell", "tool_input": {"command": "ls"}}`
- **THEN** `seen.json` holds `tool_name` equal to `Bash` and `tool_input.command` equal to `ls`

#### Scenario: Other tool names pass unchanged
- **GIVEN** a wrapper generated for a command that writes its stdin to `seen.json`
- **WHEN** the wrapper is run with stdin `{"tool_name": "Write", "tool_input": {"file_path": "/x"}}`
- **THEN** `seen.json` holds `tool_name` equal to `Write`

### Requirement: The wrapper maps the command's result to Cursor's preToolUse contract

The wrapper SHALL map the original command's result as follows. The decision SHALL be read from
`hookSpecificOutput.permissionDecision`, then top-level `permissionDecision`, then legacy `decision`.
`deny`, `ask` and `block` exit `2`. `allow` and `approve` allow. Valid JSON that is not an object
exits `2`.

| Command result | Wrapper stdout | Wrapper exit |
|---|---|---|
| exit `2` | none, command stderr forwarded | `2` |
| exit `0`, decision `deny`, `ask` or `block` (any of the three fields) | none, `permissionDecisionReason` or `reason` on stderr | `2` |
| exit `0`, decision `allow` or `approve` | `{"permission":"allow"}` plus `updated_input` when the command gave `updatedInput` | `0` |
| exit `0`, empty stdout, or a JSON object with no decision field | `{"permission":"allow"}` | `0` |
| exit `0`, stdout that is not JSON, JSON that is not an object, or a decision value not listed above | none, a reason on stderr | `2` |
| any other exit code, or the command cannot start | none, a reason on stderr | `1` |

Exit `1` lets Cursor apply its fail-open default, or block when `failClosed: true` is set. This
matches Claude, where exit codes other than `0` and `2` do not block unless `onFailure: "block"`.

#### Scenario: Exit 2 denies
- **GIVEN** a wrapper generated for a command that prints `no rm` to stderr and exits `2`
- **WHEN** the wrapper is run with a Shell payload
- **THEN** the wrapper exits `2` and its stderr contains `no rm`

#### Scenario: A JSON deny becomes exit 2 with the reason
- **GIVEN** a wrapper generated for a command that exits `0` and prints `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"blocked by policy"}}`
- **WHEN** the wrapper is run with a Shell payload
- **THEN** the wrapper exits `2` and its stderr contains `blocked by policy`

#### Scenario: A top-level permissionDecision deny exits 2
- **GIVEN** a wrapper generated for a command that exits `0` and prints `{"permissionDecision":"deny","permissionDecisionReason":"top level"}`
- **WHEN** the wrapper is run with a Shell payload
- **THEN** the wrapper exits `2` and its stderr contains `top level`

#### Scenario: A legacy decision approve allows
- **GIVEN** a wrapper generated for a command that exits `0` and prints `{"decision":"approve"}`
- **WHEN** the wrapper is run with a Shell payload
- **THEN** the wrapper stdout parses to `{"permission": "allow"}` and the wrapper exits `0`

#### Scenario: JSON null output exits 2
- **GIVEN** a wrapper generated for a command that exits `0` and prints `null`
- **WHEN** the wrapper is run with a Shell payload
- **THEN** the wrapper exits `2`

#### Scenario: Ask is treated as deny
- **GIVEN** a wrapper generated for a command that exits `0` and prints `permissionDecision: "ask"` in `hookSpecificOutput`
- **WHEN** the wrapper is run with a Shell payload
- **THEN** the wrapper exits `2`

#### Scenario: Silent success prints an explicit allow
- **GIVEN** a wrapper generated for a command that exits `0` and prints nothing
- **WHEN** the wrapper is run with a Shell payload
- **THEN** the wrapper stdout parses to `{"permission": "allow"}` and the wrapper exits `0`

#### Scenario: updatedInput is forwarded
- **GIVEN** a wrapper generated for a command that exits `0` and prints `permissionDecision: "allow"` with `updatedInput: {"command": "ls -la"}`
- **WHEN** the wrapper is run with a Shell payload
- **THEN** the wrapper stdout parses to `{"permission": "allow", "updated_input": {"command": "ls -la"}}`

#### Scenario: Output that is not JSON fails closed
- **GIVEN** a wrapper generated for a command that exits `0` and prints `ok`
- **WHEN** the wrapper is run with a Shell payload
- **THEN** the wrapper exits `2`

#### Scenario: A crash is passed to Cursor's fail mode
- **GIVEN** a wrapper generated for a command that exits `1`
- **WHEN** the wrapper is run with a Shell payload
- **THEN** the wrapper exits `1` and prints nothing on stdout

#### Scenario: A missing command is passed to Cursor's fail mode
- **GIVEN** a wrapper generated for the command `./does-not-exist.sh`
- **WHEN** the wrapper is run with a Shell payload
- **THEN** the wrapper exits `1`

### Requirement: The Claude hook and the Cursor wrapper both run, and that is reported

When `.claude/settings.json` holds the same guardrail and Cursor's Third-Party Imports setting is on,
Cursor runs both the Claude hook and the wrapper. An allowed call
runs the original command twice. This is accepted behaviour. Cursor merges deny over allow across
sources. [UNVERIFIED until a live test with one allow hook and one deny hook runs.] The reason on each written Cursor hook
item SHALL state that the command runs twice when `.claude/settings.json` also holds it and
Third-Party Imports is on.

#### Scenario: The double run is stated in the report
- **GIVEN** a directory holding `.claude/settings.json` with a PreToolUse `Bash` guardrail
- **WHEN** converting from claude to cursor with no `--target`
- **THEN** the item of kind `hook` named `PreToolUse` has a reason containing `runs twice`
- **AND** `.claude/settings.json` is byte-identical to its content before the run

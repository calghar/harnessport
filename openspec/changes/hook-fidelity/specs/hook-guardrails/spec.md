## ADDED Requirements

### Requirement: A guardrail a target cannot write or enforce is blocked

A guardrail is a hook whose `event` is one of `PreToolUse`, `PermissionRequest` or `UserPromptSubmit`.
When an exporter does not write a hook, it SHALL report the hook as `blocked` if the hook is a
guardrail, and as `dropped` otherwise. A `blocked` item makes `harnessport convert` exit `2`
(`src/index.ts:135-139`). A `dropped` item leaves the exit code unchanged. The item has kind `hook`,
name equal to the hook `event`, and a reason naming the target and the limitation.

#### Scenario: A claude PreToolUse hook exported to opencode is blocked
- **GIVEN** a canonical config holding a hook `{event: "PreToolUse", matcher: "Bash", command: "./guard.sh"}`
- **WHEN** converting from claude to opencode
- **THEN** the item of kind `hook` named `PreToolUse` has status `blocked`
- **AND** its reason names `tool.execute.before`
- **AND** the process exits `2`

#### Scenario: A claude PostToolUse hook exported to opencode is dropped
- **GIVEN** a canonical config holding only a hook `{event: "PostToolUse", matcher: "Bash", command: "./log.sh"}`
- **WHEN** converting from claude to opencode
- **THEN** the item of kind `hook` named `PostToolUse` has status `dropped`
- **AND** the process exits `0`

#### Scenario: Formatters on opencode are unchanged
- **GIVEN** a canonical config holding one formatter `{glob: "*.ts", command: "prettier --write"}` and one PostToolUse hook
- **WHEN** exporting to opencode
- **THEN** the emitted `opencode.json` carries the same `formatter` key as before this change
- **AND** the item of kind `formatter` has status `exact`

### Requirement: A hook written for another dialect is not exported as if it were Claude-shaped

Each hook has a dialect: the stdin and stdout contract its command expects. A hook without a
dialect has dialect `claude`. A Copilot hook imported from a camelCase event key has dialect
`copilot` and is imported under the Claude event name (`preToolUse` to `PreToolUse`,
`postToolUse` to `PostToolUse`, `userPromptSubmitted` to `UserPromptSubmit`, `sessionStart` to
`SessionStart`, `sessionEnd` to `SessionEnd`, `agentStop` to `Stop`, `preCompact` to `PreCompact`,
`subagentStop` to `SubagentStop`). `errorOccurred` keeps its name and is not a guardrail. An exporter whose target does not accept the hook's dialect
SHALL report a guardrail as `blocked`. A non-guardrail hook of an unaccepted dialect SHALL NOT be
written and SHALL be reported `dropped`, with a reason naming the dialect. Claude, Cursor and Codex
accept `claude`. Copilot accepts `claude` and `copilot`.

#### Scenario: A copilot camelCase preToolUse hook exported to claude is blocked
- **GIVEN** `.github/hooks/hooks.json` holding `{version: 1, hooks: {preToolUse: [{type: "command", bash: "./guard.sh"}]}}`
- **WHEN** converting from copilot to claude
- **THEN** the imported hook has event `PreToolUse` and dialect `copilot`
- **AND** the export item of kind `hook` named `PreToolUse` has status `blocked`
- **AND** `.claude/settings.json` holds no entry for `./guard.sh`

#### Scenario: A copilot camelCase hook round-trips to copilot under its camelCase key
- **GIVEN** `.github/hooks/hooks.json` holding `{version: 1, hooks: {postToolUse: [{type: "command", bash: "./log.sh"}]}}`
- **WHEN** converting from copilot to copilot into a new directory
- **THEN** the emitted `.github/hooks/hooks.json` has key `hooks.postToolUse` holding `bash: "./log.sh"`

#### Scenario: A copilot PascalCase PreToolUse hook exported to claude is exact
- **GIVEN** `.github/hooks/hooks.json` holding `{PreToolUse: [{type: "command", bash: "./scripts/guard.sh"}]}` with no `version` key
- **WHEN** converting from copilot to claude
- **THEN** the imported hook has no dialect
- **AND** `.claude/settings.json` holds `hooks.PreToolUse[0].hooks[0].command` equal to `./scripts/guard.sh`

### Requirement: Claude hook fields are carried or reported on import

The Claude importer SHALL read, for each handler in `.claude/settings.json` `hooks`, the fields
`type`, `command`, `args`, `timeout`, `onFailure` and `if`. It SHALL carry `onFailure: "block"` as
`failClosed: true`, `timeout` as `timeout` in seconds, and `args` as `args`. The Claude exporter
SHALL write `failClosed: true` back as `onFailure: "block"`, and SHALL write `timeout` and `args`
unchanged. A handler with an `if` field SHALL import without it, with an import item of status
`lossy` whose reason states that the hook now fires on every matcher hit. A handler whose `type` is
not `command` SHALL NOT be imported as a hook. It SHALL produce an import item of status `blocked`
for a guardrail and `dropped` otherwise, with a reason naming the `type`. A handler with no `type` SHALL be treated as `command`. An
`onFailure` value other than `block` SHALL import with `failClosed` absent.

#### Scenario: A handler with no type imports as a command hook
- **GIVEN** `.claude/settings.json` holding a PreToolUse handler `{command: "./guard.sh", onFailure: "continue"}` with no `type`
- **WHEN** importing from claude
- **THEN** the canonical config holds a hook `{event: "PreToolUse", command: "./guard.sh"}` with no `failClosed`

#### Scenario: onFailure, timeout and args round-trip from claude to claude
- **GIVEN** `.claude/settings.json` holding `hooks.PreToolUse[0] = {matcher: "Bash", hooks: [{type: "command", command: "guard", args: ["--strict"], timeout: 10, onFailure: "block"}]}`
- **WHEN** converting from claude to claude into a new directory
- **THEN** the emitted `.claude/settings.json` holds that handler with `args: ["--strict"]`, `timeout: 10` and `onFailure: "block"`
- **AND** the item of kind `hook` named `PreToolUse` has status `exact`

#### Scenario: An if condition is reported lossy
- **GIVEN** `.claude/settings.json` holding a PreToolUse handler `{type: "command", command: "./guard.sh", if: "Bash(rm *)"}`
- **WHEN** importing from claude
- **THEN** an import item of kind `hook` named `PreToolUse` has status `lossy`
- **AND** its reason states that the hook fires on every matcher hit

#### Scenario: An http guardrail is blocked on import and not written with an empty command
- **GIVEN** `.claude/settings.json` holding a PreToolUse handler `{type: "http", url: "https://example.test/hook"}`
- **WHEN** converting from claude to copilot
- **THEN** an import item of kind `hook` named `PreToolUse` has status `blocked` and its reason names `http`
- **AND** the canonical config holds no hook with an undefined `command`
- **AND** the process exits `2`

#### Scenario: A prompt hook on a non-guardrail event is dropped on import
- **GIVEN** `.claude/settings.json` holding a Stop handler `{type: "prompt", prompt: "check"}`
- **WHEN** importing from claude
- **THEN** an import item of kind `hook` named `Stop` has status `dropped`

#### Scenario: A plain command hook is emitted unchanged
- **GIVEN** a canonical config holding a hook `{event: "PreToolUse", matcher: "Bash", command: "./guard.sh"}` with no other field
- **WHEN** exporting to claude into a new directory
- **THEN** `.claude/settings.json` holds `hooks.PreToolUse[0]` equal to `{hooks: [{type: "command", command: "./guard.sh"}], matcher: "Bash"}`

### Requirement: Existing Claude settings are not removed or rewritten

An export SHALL NOT change the bytes of an existing `.claude/settings.json` or
`.claude/settings.local.json` unless `--force` is given. With `--force` the previous file is kept as
`<path>.bak`, as `writeIfNotDry` does today (`src/utils.ts:281-322`).

#### Scenario: Converting from claude to cursor in place leaves the Claude files unchanged
- **GIVEN** a directory holding `.claude/settings.json` with a PreToolUse `Bash` guardrail and `.claude/settings.local.json` with a `deny` permission
- **WHEN** converting from claude to cursor with no `--target`
- **THEN** both files are byte-identical to their content before the run

#### Scenario: Exporting to claude over a different settings file is blocked
- **GIVEN** a target directory holding a `.claude/settings.json` whose content differs from what the export would write
- **WHEN** converting from copilot to claude into that directory without `--force`
- **THEN** the file is byte-identical to its content before the run
- **AND** an item names that path with status `blocked`

### Requirement: Copilot hooks file has the documented shape and keeps matcher and timeout

The Copilot exporter SHALL write `.github/hooks/hooks.json` as `{version: 1, hooks: {<Event>: [<entry>]}}`.
A hook of dialect `claude` is keyed by its Claude event name. A hook of dialect `copilot` is keyed
by its Copilot camelCase name. Each entry is `{type: "command", bash, matcher?, timeoutSec?}`, with
`timeoutSec` equal to the hook `timeout`. For `PreToolUse` the Claude matcher is written unchanged.
PascalCase PreToolUse accepts Claude and runtime tool names (Copilot reference).
Matcher translation applies only to hooks of dialect `claude`. A `copilot`-dialect matcher is written unchanged.
For a `claude`-dialect `PostToolUse` hook each `|` token is translated to Copilot runtime names: `Bash` to `bash|powershell`,
`Edit` to `edit|str_replace_editor|apply_patch`, `Write` to `create`, `Read` to `view`, `Grep` to
`grep|rg`, `Glob` to `glob`, `WebFetch` to `web_fetch`. A `PostToolUse` matcher with any other token
SHALL be reported `dropped`. A `UserPromptSubmit` or `PermissionRequest` guardrail SHALL be reported
`blocked`. A guardrail with `failClosed: true` SHALL be reported `blocked` on Copilot. A non-guardrail
hook with `failClosed` SHALL be reported `lossy`. A hook with `args` SHALL be reported `blocked` if the
hook is a guardrail, otherwise `dropped`, as the first requirement defines, because `bash` holds one
shell string. A PreToolUse hook of dialect `claude` written to Copilot SHALL be reported `lossy`. The
reason SHALL state that Copilot reads top-level `permissionDecision` and not nested
`hookSpecificOutput`, so a Claude JSON deny is not enforced, and that exit `0` with no output counts
as allow. This applies to every `claude`-dialect PreToolUse export, because harnessport cannot read
which way a script denies. `blocked` outranks `lossy` when both apply. The importer SHALL read both
the `{version, hooks}` form and the bare form, and SHALL read `matcher` and `timeoutSec` (or `timeout`).

#### Scenario: The copilot file has the version wrapper
- **GIVEN** a canonical config holding a hook `{event: "PreToolUse", matcher: "Bash", command: "./guard.sh", timeout: 10}`
- **WHEN** converting from claude to copilot into a new directory
- **THEN** `.github/hooks/hooks.json` parses to an object with `version: 1` and a `hooks` object
- **AND** `hooks.PreToolUse[0]` equals `{type: "command", bash: "./guard.sh", matcher: "Bash", timeoutSec: 10}`

#### Scenario: A copilot PostToolUse matcher is translated to runtime names
- **GIVEN** a canonical config holding a hook `{event: "PostToolUse", matcher: "Edit|Write", command: "./log.sh"}`
- **WHEN** converting from claude to copilot into a new directory
- **THEN** `hooks.PostToolUse[0].matcher` contains `edit` and `create`

#### Scenario: A copilot postToolUse matcher survives a copilot round trip
- **GIVEN** `.github/hooks/hooks.json` holding `{version: 1, hooks: {postToolUse: [{type: "command", bash: "./log.sh", matcher: "edit|create"}]}}`
- **WHEN** converting from copilot to copilot into a new directory
- **THEN** `hooks.postToolUse[0].matcher` in the emitted file equals `edit|create`

#### Scenario: A claude PreToolUse hook exported to copilot is lossy
- **GIVEN** a canonical config holding a hook `{event: "PreToolUse", matcher: "Bash", command: "./guard.sh"}`
- **WHEN** converting from claude to copilot
- **THEN** the item of kind `hook` named `PreToolUse` has status `lossy`
- **AND** its reason contains `hookSpecificOutput`

#### Scenario: A failClosed guardrail exported to copilot is blocked
- **GIVEN** a canonical config holding a hook `{event: "PreToolUse", matcher: "Bash", command: "./guard.sh", failClosed: true}`
- **WHEN** converting from claude to copilot
- **THEN** the item of kind `hook` named `PreToolUse` has status `blocked`
- **AND** the process exits `2`

#### Scenario: A PermissionRequest guardrail exported to copilot is blocked
- **GIVEN** a canonical config holding a hook `{event: "PermissionRequest", command: "./perm.sh"}`
- **WHEN** converting from claude to copilot
- **THEN** the item of kind `hook` named `PermissionRequest` has status `blocked`

#### Scenario: A PostToolUse matcher with an unknown token is dropped
- **GIVEN** a canonical config holding a hook `{event: "PostToolUse", matcher: "NotebookEdit", command: "./log.sh"}`
- **WHEN** converting from claude to copilot
- **THEN** the item of kind `hook` named `PostToolUse` has status `dropped`
- **AND** the process exits `0`

#### Scenario: A UserPromptSubmit guardrail exported to copilot is blocked
- **GIVEN** a canonical config holding a hook `{event: "UserPromptSubmit", command: "./prompt.sh"}`
- **WHEN** converting from claude to copilot
- **THEN** the item of kind `hook` named `UserPromptSubmit` has status `blocked`
- **AND** its reason states that Copilot drops the output of config-file `userPromptSubmitted` hooks

#### Scenario: An exec-form guardrail exported to copilot is blocked
- **GIVEN** a canonical config holding a hook `{event: "PreToolUse", matcher: "Bash", command: "guard", args: ["--strict"]}`
- **WHEN** converting from claude to copilot
- **THEN** the item of kind `hook` named `PreToolUse` has status `blocked`

#### Scenario: A copilot file written by 0.2.1 still imports
- **GIVEN** `tests/fixtures/copilot-project/.github/hooks/hooks.json` in the bare form `{PreToolUse: [{type: "command", bash: "./scripts/guard.sh"}]}`
- **WHEN** importing from copilot
- **THEN** the canonical config holds one hook `{event: "PreToolUse", command: "./scripts/guard.sh"}`

### Requirement: Codex hooks report matchers and fail-closed settings they cannot honour

The Codex exporter SHALL write a hook only when every `|` token of its matcher is `Bash`, or the
matcher is `*`, empty or absent. A hook the exporter does not write SHALL be reported `blocked` if
the hook is a guardrail, otherwise `dropped`, as the first requirement defines. The exporter does
not write a hook with any other token (the reason names the token), with `failClosed: true`
(because no Codex fail-closed field is verified), or with `args`. A written hook
with a `timeout` SHALL be reported `lossy`, because no Codex timeout field is verified.

#### Scenario: A codex Edit|Write guardrail is blocked
- **GIVEN** a canonical config holding a hook `{event: "PreToolUse", matcher: "Edit|Write", command: "./guard.sh"}`
- **WHEN** converting from claude to codex
- **THEN** the item of kind `hook` named `PreToolUse` has status `blocked`
- **AND** its reason names `Edit`

#### Scenario: A codex failClosed guardrail is blocked
- **GIVEN** a canonical config holding a hook `{event: "PreToolUse", matcher: "Bash", command: "./guard.sh", failClosed: true}`
- **WHEN** converting from claude to codex
- **THEN** the item of kind `hook` named `PreToolUse` has status `blocked`

#### Scenario: A codex Bash hook is emitted unchanged
- **GIVEN** a canonical config holding a hook `{event: "PreToolUse", matcher: "Bash", command: "./guard.sh"}`
- **WHEN** converting from claude to codex into a new directory
- **THEN** `.codex/hooks.json` equals `{hooks: {PreToolUse: [{matcher: "Bash", hooks: [{type: "command", command: "./guard.sh"}]}]}}`
- **AND** the item of kind `hook` named `PreToolUse` has status `exact`

### Requirement: The Claude formatter reads the edited file path from stdin

The Claude exporter SHALL write each formatter as a `PostToolUse` handler with matcher
`Edit|Write|MultiEdit` and command `node "$CLAUDE_PROJECT_DIR/.claude/hooks/harnessport-format.mjs" "<glob>" <formatter command>`.
It SHALL write the runner `.claude/hooks/harnessport-format.mjs`. The runner reads stdin JSON, takes
`tool_input.file_path`, and runs the formatter command split on whitespace with that path as the
last argument, without a shell. It exits `0` without running anything when `file_path` is absent.
The runner SHALL exit `0` without running the formatter when the path does not match the formatter
`glob`. The formatter's non-zero exit SHALL be the runner's exit. An existing
`.claude/hooks/harnessport-format.mjs` with different content SHALL be reported `blocked` unless
`--force` is given. The importer SHALL treat a `PostToolUse` handler whose command contains the marker string
`harnessport-format.mjs` as a formatter, whose glob is the first argument after the runner path and
whose command is the text after the glob. A handler
matching the earlier `$FILEPATH` form SHALL still import as a formatter. A formatter command or glob
containing any of `"`, `'`, `|`, `&`, `;`, `$`, `<`, `>` or a backtick SHALL be reported `dropped`.

#### Scenario: A formatter exported to claude uses the runner
- **GIVEN** a canonical config holding a formatter `{glob: "*.ts", command: "biome format --write"}`
- **WHEN** converting from opencode to claude into a new directory
- **THEN** `.claude/settings.json` holds `hooks.PostToolUse[0].hooks[0].command` equal to `node "$CLAUDE_PROJECT_DIR/.claude/hooks/harnessport-format.mjs" "*.ts" biome format --write`
- **AND** `hooks.PostToolUse[0].matcher` equals `Edit|Write|MultiEdit`
- **AND** the file `.claude/hooks/harnessport-format.mjs` exists

#### Scenario: The runner passes the file path from stdin
- **GIVEN** the emitted `.claude/hooks/harnessport-format.mjs` with glob `*.ts` and a formatter command `node record.mjs` that writes its last argument to a file
- **WHEN** the runner is run with stdin `{"tool_input": {"file_path": "/tmp/x/a.ts"}}`
- **THEN** the recorded argument equals `/tmp/x/a.ts`
- **AND** the runner exits `0`

#### Scenario: A formatter skips a non-matching path
- **GIVEN** the emitted runner with glob `*.ts` and a formatter command that writes a file when run
- **WHEN** the runner is run with stdin `{"tool_input": {"file_path": "/tmp/x/a.py"}}`
- **THEN** no file is written
- **AND** the runner exits `0`

#### Scenario: The runner does nothing without a file path
- **GIVEN** the emitted runner and a formatter command that writes a file when run
- **WHEN** the runner is run with stdin `{"tool_input": {}}`
- **THEN** no file is written
- **AND** the runner exits `0`

#### Scenario: A runner command imports back as a formatter
- **GIVEN** `.claude/settings.json` written by the first scenario
- **WHEN** importing from claude
- **THEN** the canonical config holds one formatter with glob `*.ts` and command `biome format --write`
- **AND** holds no hook whose command contains `harnessport-format.mjs`

#### Scenario: A legacy $FILEPATH formatter still imports
- **GIVEN** `.claude/settings.json` holding a PostToolUse handler `{matcher: "Edit|Write|MultiEdit", hooks: [{type: "command", command: "prettier --write $FILEPATH"}]}`
- **WHEN** importing from claude
- **THEN** the canonical config holds one formatter with command `prettier --write`

#### Scenario: A formatter with shell syntax is dropped
- **GIVEN** a canonical config holding a formatter `{glob: "*.py", command: "ruff format && ruff check --fix"}`
- **WHEN** exporting to claude
- **THEN** the item of kind `formatter` has status `dropped` and its reason names the `&` character

#### Scenario: A differing runner file is blocked without force
- **GIVEN** a target directory holding `.claude/hooks/harnessport-format.mjs` whose content differs from the runner the export would write
- **WHEN** exporting a formatter to claude into that directory without `--force`
- **THEN** the file is byte-identical to its content before the run
- **AND** an item names `.claude/hooks/harnessport-format.mjs` with status `blocked`

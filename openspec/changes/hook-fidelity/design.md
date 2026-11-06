## Context

Claude guardrail hooks lose enforcement on other targets while the run succeeds. Cursor sends `Shell`
where a Claude `Bash` matcher and script expect `Bash`. OpenCode drops guardrails as
`dropped`. Copilot loses `matcher` and the `{version, hooks}` wrapper. Claude import discards
`onFailure`, `timeout`, `args` and `if`, and writes non-command hooks with an undefined command. The
Claude formatter appends `$FILEPATH`, which Claude does not define.

Scope follows `proposal.md`. This change is sequenced after `capability-matrix` and
`conversion-matrix`. It supersedes the `capability-matrix` scenario "A dropped hook does not fail the
run" (`tests/capabilities.test.ts:257-260`).

Sources: Cursor `cursor.com/docs/hooks` and `cursor.com/docs/reference/third-party-hooks`. Copilot
`docs.github.com/en/copilot/reference/hooks-configuration`. Claude `code.claude.com/docs/en/hooks`.
All fetched 2026-11-06. Codex facts are
third-party only.

## Goals / Non-Goals

Goals:
- A guardrail a target cannot write or enforce is `blocked` and the run exits `2`.
- Claude guardrails reach Cursor through a Node wrapper that renames `Shell` to `Bash`.
- Copilot and Codex report the matchers and fail-closed settings they cannot honour.
- Claude hook fields are carried or reported.
- The Claude formatter receives the edited path.

Non-Goals:
- Cursor import of `.cursor/hooks.json`. `cursor.ts:199` keeps `hooks: []`.
- Writing OpenCode hooks.
- Naming hook items `Event(matcher)`. `src/compare.ts:48` is unchanged.
- Rejecting commands that reference `CLAUDE_*` variables.
- Copilot `powershell` handlers.

## Decisions

Each line gives the chosen option, the reason, and the touched code.

1. **Guardrail set and `hookStatus`.** `GUARDRAIL_EVENTS = {PreToolUse, PermissionRequest, UserPromptSubmit}` and `hookStatus(hook, targetName, limitation, phase = "export")` go in `src/utils.ts` after `permissionStatus` (`:523-545`, unchanged). Reason: it mirrors `permissionStatus`, so one rule decides every hook loss.
2. **Split `hooksFormatters`.** `generateDropItems` (`src/utils.ts:550-589`, branch `:584-586`) takes `hooks?` and `formatters?` instead. Hooks route through `hookStatus`. Reason: Cursor now writes hooks but still drops formatters. Caller: `cursor.ts:222-224`. `codex.ts:169` passes neither key and needs only a regression test.
3. **Schema.** `Hook` (`src/schema.ts:66-70`) gains `failClosed?: boolean`, `timeout?: number`, `args?: string[]`, `dialect?: "claude" | "copilot"`. Reason: these are the fields a target must see to decide enforcement. Import sites: `claude.ts:205-231`, `copilot.ts:122-142`. Export sites: `claude.ts:333-356`, `copilot.ts:233-250`, `codex.ts:65-88`, new Cursor export in `cursor.ts:205-245`. `opencode.ts:611-623` reads only `event`.
4. **OpenCode.** `opencode.ts:611-623` calls `hookStatus` with a reason naming `tool.execute.before`. Reason: harnessport does not generate plugins.
5. **Claude import fields.** `HooksJson` (`claude.ts:194-199`) and `HookEntry` (`claude.ts:331`) gain `type`, `args`, `timeout`, `onFailure`, `if`. `importHooks` (`claude.ts:205-231`) maps `onFailure: "block"` to `failClosed`, carries `timeout` and `args`, reports `if` as `lossy`, and reports non-command `type` through `hookStatus` with phase `import`. `buildHooksJson` (`claude.ts:333-356`) writes them back. The hook item at `claude.ts:529` stays `exact`, except a non-`claude` dialect goes through `hookStatus`. Reason: `if` has no field on any other target, so it is reported, not carried.
6. **Dialect check inline.** Each exporter compares `hook.dialect ?? "claude"` with the dialects it accepts. Reason: three call sites with one comparison each do not need a helper.
7. **Copilot.** `extractCommandFromHandler` (`copilot.ts:114-120`) also returns `matcher` and `timeoutSec ?? timeout`. `importHooks` (`copilot.ts:122-142`) unwraps `{version, hooks}` and keeps the bare form, following `codex.ts:43-45`. It maps camelCase keys to Claude events with `dialect: "copilot"`. `exportHooks` (`copilot.ts:233-250`) writes `{version: 1, hooks}`, keys by dialect, and translates PostToolUse matchers of `claude`-dialect hooks with a constant table in `copilot.ts`. A `copilot`-dialect matcher is written unchanged. PascalCase PreToolUse accepts Claude and runtime tool names (Copilot reference). `exactItems("hook")` at `copilot.ts:324` becomes per-hook items. Reason: the Copilot reference documents only the wrapped, flat-entry form.
8. **Codex.** `exportHooks` (`codex.ts:65-88`) writes a hook only when its matcher tokens are all `Bash`, or it is `*`, empty or absent, and it has no `failClosed` or `args`. `exactItems("hook")` at `codex.ts:180` becomes per-hook items. Import (`codex.ts:34-61`) is unchanged. Reason: `Bash` is the only tool name evidenced, and no fail-closed field is evidenced.
9. **Cursor wrapper in Node.** User decision. Reason: Windows Cursor runs hook commands through PowerShell, and `node file.mjs` runs there. A POSIX `sh` wrapper does not. The wrapper template is one string constant in `cursor.ts`, prefixed per hook by `const HOOK = <JSON.stringify({command, args})>;`. `cursor.ts` gains `exportHooks`, called from `export` (`cursor.ts:205-245`), writing through `writeIfNotDry` (`src/utils.ts:281`). Capability `cursor.ts:173` becomes `full`. `cursor.ts:222-224` stops dropping hooks and keeps the formatter drop.
10. **Only `preToolUse` gets a wrapper.** Reason: Cursor `beforeSubmitPrompt` blocks through `continue`, and exit `2` is not documented for it. `PermissionRequest` has no Cursor event. Non-guardrails are `dropped`, because Cursor loads them natively from `.claude/settings.json` and writing them again would run them twice with no enforcement gain.
11. **MCP, Task, Glob and regex matchers on Cursor are `blocked`.** Reason: the script would see a different `tool_name` (for example `MCP:create_issue` for `mcp__github__create_issue`) and allow the call. The user accepted `lossy` only for `Edit` to `Write`.
12. **Claude hook kept, double run accepted.** User decision. The Cursor exporter writes nothing under `.claude/`. Reason: removing the Claude entry breaks Claude, which the user keeps. Cursor merges deny over allow across sources (third-party hooks page, F5 in the analysis) [UNVERIFIED until a live test with one allow hook and one deny hook runs].
13. **Wrapper fail mode.** Exit `2` for a deny, an `ask`, non-JSON stdout, or an unknown decision. Exit `1` for a crash or a spawn error. Reason: exit `1` keeps Claude's fail-open default, and `failClosed: true` (carried from `onFailure: "block"`) makes Cursor block on it. Explicit `{"permission":"allow"}` on allow avoids relying on Cursor's undocumented empty-output case.
14. **Formatter runner.** User decision. `buildHooksJson` formatter branch (`claude.ts:347-353`) writes `node "$CLAUDE_PROJECT_DIR/.claude/hooks/harnessport-format.mjs" "<glob>" <command>`. The formatter `glob` is a runner argument. The runner exits `0` without running the formatter when the path does not match it, and exits with the formatter's non-zero code. `exportSettings` (`claude.ts:380-393`) also writes the runner file when formatters exist. `isFormatterHook` (`claude.ts:173-184`) and the strip at `claude.ts:219-224` accept the marker `harnessport-format.mjs` and the legacy `$FILEPATH`. `formatterItem` (`claude.ts:416-429`) reports `dropped` for a command with shell metacharacters. Reason: the runner spawns without a shell, so the path needs no quoting. A command that needs a shell cannot run that way.

## Risks / Trade-offs

Per converter, effect on emitted output:

| Converter | Emitted output changes? | Detail |
|---|---|---|
| Claude | Yes | Formatter command and new `.claude/hooks/harnessport-format.mjs`. Handlers gain `onFailure`, `timeout`, `args` when the source had them. A plain command hook is unchanged, which the spec scenario "A plain command hook is emitted unchanged" asserts. |
| OpenCode | No file change | Guardrail item moves from `dropped` to `blocked`. The run exits `2`. |
| Cursor | Yes | New `.cursor/hooks.json` and `.cursor/hooks/harnessport-guard-<n>.mjs`. |
| Copilot | Yes | `.github/hooks/hooks.json` gains `{version: 1, hooks}`, `matcher` and `timeoutSec`. BREAKING. |
| Codex | Only for refused hooks | A hook with a non-`Bash` matcher token, `failClosed` or `args` is no longer written. Other hooks are byte-identical, which "A codex Bash hook is emitted unchanged" asserts. |

Other risks:
- Node must be on `PATH` under Cursor. The item reason states it. Without Node the wrapper cannot start and Cursor fails open, or blocks when `failClosed` is set.
- The wrapper runs the original command through the platform shell. On Windows that is `cmd.exe`, so a bash command line may not run. This matches the native Claude hook under Cursor.
- An allowed call runs the guardrail twice under Cursor. Side effects run twice.
- Fail-closed on non-JSON stdout is stricter than Claude. A script that prints a log line on allow blocks every call under Cursor (open question 6).
- Exit `2` from a blocked guardrail breaks scripts that convert to OpenCode or Copilot today.

## Migration Plan

- Copilot files written by 0.2.1 are in the bare form. The new importer still reads them ("A copilot file written by 0.2.1 still imports"). Re-run the conversion to get the wrapped file with matchers.
- Claude formatter entries written by 0.2.1 use `$FILEPATH`. The new importer still reads them. Re-run a conversion into Claude to get the runner. `writeIfNotDry` reports `blocked` on the differing `.claude/settings.json` unless `--force`, which keeps a `.bak`.
- Cursor users gain `.cursor/hooks.json` on the next run. Nothing earlier wrote it.

## Rollback

Pin `harnessport@0.2.1`. Files from this version read under 0.2.1 as follows:
- Wrapped Copilot `hooks.json`: 0.2.1 imports zero hooks from it, because `copilot.ts:135` skips non-array values. The loss is not reported.
- Claude handlers with `onFailure`, `timeout`, `args`: 0.2.1 imports them without those fields.
- Claude runner formatter: 0.2.1 imports it as a plain PostToolUse hook, because `claude.ts:182` needs `$FILEPATH`.
- `.cursor/hooks.json`: 0.2.1 ignores it.

## Open Questions

All resolved.

1. **Copilot PascalCase events in the cloud agent.** The reference does not say. Test: one PascalCase `PreToolUse` deny hook in a cloud-agent run. Resolved: Copilot writes PascalCase keys for Claude-dialect hooks.
2. **Copilot and Cursor exit `0` with no output.** Neither page states it is a valid allow. Cursor is covered by the wrapper's explicit allow. Resolved: Copilot treats exit 0 with no output as allow, marked lossy where a guardrail depends on it.
3. **Cursor firing `beforeShellExecution` and `preToolUse` for one call.** Not stated. Resolved: Cursor writes only preToolUse (not beforeShellExecution) for Claude Bash guardrails.
4. **Codex payload shape (V8).** Official docs were unreachable. Resolved: Codex hooks stay Claude-shaped (tool_name / tool_input) until verified.
5. **Fifth-target hook docs.** The English URL redirects to a different product. Resolved: the target is dropped from the tool entirely. Its removal is a separate OpenSpec change, not in this change.
6. **Cursor wrapper on invalid output.** The alternative was to allow, as Claude does. Resolved: the Cursor wrapper fails closed (exit 2) on invalid JSON output.
7. **Copilot `failClosed` guardrail.** Copilot command `preToolUse` fails closed on crash and non-zero exit, but timeouts fail open. Resolved: a guardrail with failClosed exported to Copilot is blocked.
8. **Copilot reading Claude `hookSpecificOutput`.** The reference documents only top-level `permissionDecision`. Exit `2` denies are documented. Resolved: every `claude`-dialect PreToolUse hook exported to Copilot is reported lossy, because harnessport cannot read which way a script denies. The reason names hookSpecificOutput.
9. **Cursor `hook_event_name` for `preToolUse`.** Does the wrapper rewrite it? Resolved: no. A live test records Cursor's `hook_event_name` value for `preToolUse`.

## Requirements analysis

Applied in this file to the twelve requirements in `specs/`. Criteria: testable (T), solution-free (S), unambiguous (U), consistent (C), complete (Cm).

| Requirement | T | S | U | C | Cm | Result |
|---|---|---|---|---|---|---|
| A guardrail a target cannot write or enforce is blocked | pass | pass | pass | Conflicts with `capability-matrix` "A dropped hook does not fail the run" | pass | Pass. Conflict resolved by sequencing and by rewriting `tests/capabilities.test.ts:257-260` (task 2.6). |
| A hook written for another dialect is not exported as if it were Claude-shaped | pass | pass | REFINED: "Copilot dialect" was undefined | pass | REFINED: `errorOccurred` had no mapping | REFINED. Rewrite: the camelCase-to-Claude event table is listed in the requirement. `errorOccurred` imports with dialect `copilot` under its own name and is a non-guardrail. Codex accepting `claude` depends on open question 4. |
| Claude hook fields are carried or reported on import | pass | pass | pass | pass | pass | Pass. `async` is not read. It is outside the proposal scope. |
| Existing Claude settings are not removed or rewritten | pass (byte-identical scenarios) | pass | pass | pass | pass | Pass. The absolute "SHALL NOT change the bytes" is falsified by either of its two scenarios. |
| Copilot hooks file has the documented shape and keeps matcher and timeout | pass | Names the file shape, which is the observable artifact | pass | pass | Fails for `failClosed` and for JSON deny | Resolved by open questions 7 and 8: a `failClosed` guardrail is `blocked`, a `claude`-dialect PreToolUse hook is `lossy`. |
| Codex hooks report matchers and fail-closed settings they cannot honour | pass | pass | pass | pass | pass | Pass, conditional on open question 4. |
| The Claude formatter reads the edited file path from stdin | pass | Names a Node runner and a marker, by user decision | REFINED: "split on whitespace" did not say how quoted text is handled | pass | pass | REFINED. Rewrite: a command with a quote or shell metacharacter is `dropped`, so whitespace splitting is not applied to quoted text. Falsified by "A formatter with shell syntax is dropped" if it fails. |
| Claude guardrails export to Cursor through a generated Node wrapper | pass | Names Node, by user decision | pass | pass | pass | Pass. |
| Cursor matchers and events are mapped or reported | pass | pass | REFINED: the character rule also caught `*` | pass | pass | REFINED. Rewrite: "any matcher other than a lone `*` that contains a character outside letters, digits, `_` and `|`". |
| The wrapper renames `Shell` to `Bash` | pass | pass | pass | pass | pass | Pass. `tool_input` field names other than `command` are passed through unchanged. |
| The wrapper maps the command's result to Cursor's preToolUse contract | pass | pass | pass | pass | Depends on open question 6 | Pass with the fail-closed default. |
| The Claude hook and the Cursor wrapper both run, and that is reported | Partly: the double run itself needs a live Cursor session | pass | pass | pass | pass | Pass. Repo test checks the reason text and the unchanged Claude file. Cursor's deny-wins merge is falsified only by a live test with one allow hook and one deny hook. |

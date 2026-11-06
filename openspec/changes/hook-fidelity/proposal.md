## Why

Claude guardrail hooks stop enforcing on other harnesses, and the run still succeeds. Cursor sends `Shell` where a Claude `Bash` matcher expects `Bash`, and OpenCode drops guardrails with a warning.

## What Changes

- **ADDED** Cursor hook export. harnessport writes `.cursor/hooks.json` with one generated wrapper per Claude guardrail. The wrapper renames `Shell`→`Bash`. Cursor's `Write` covers both creates and edits, and Cursor does not say which, so an `Edit` matcher on it is reported `lossy`. The wrapper runs the original command, and maps its result to Cursor's contract: exit 2 denies, a JSON deny becomes exit 2 with the reason, allow prints an explicit `permission: allow`. Invalid wrapper output fails closed (exit 2). `.claude/settings.json` is not changed.
- **ADDED** `hookStatus` helper in `src/utils.ts`, beside `permissionStatus`. A guardrail a target cannot write or enforce is `blocked`. Any other hook is `dropped`.
- **MODIFIED** OpenCode: PreToolUse guardrails report `blocked` instead of `dropped`. **BREAKING**: the run now fails on them.
- **MODIFIED** Claude import: `onFailure`, `if`, `timeout`, `args` and non-command `type` are carried or reported, not discarded. Non-command hooks are no longer written with an empty command. **BREAKING**: emitted Claude output changes only for hooks that were previously broken.
- **MODIFIED** Copilot export: `.github/hooks/hooks.json` gets the `{version: 1, hooks}` wrapper and keeps `matcher` and `timeoutSec`. **BREAKING**: file shape changes.
- **MODIFIED** Codex export: matcher tokens outside the verified set and `failClosed` guardrails report `blocked`.
- **MODIFIED** Claude formatter export: the formatter reads `tool_input.file_path` from stdin instead of `$FILEPATH`, which Claude does not define. **BREAKING**: emitted formatter command changes. Open decision 3.
- **REMOVED**: none.

## Capabilities

### Modified Capabilities
- None. `openspec/specs/` is empty. The conversion-reporting behaviour it would hold is currently specified only inside open changes (see Blast radius).

### New Capabilities
- `hook-guardrails`: blocked-versus-dropped rule for hooks on each target; fail-closed for guardrails.
- `cursor-hook-wrapper`: generated Cursor wrapper contract (tool-name rename, output mapping, invalid-output handling).

## Blast radius

Grep-confirmed. No LSP or graph tool was used for TypeScript. Launch from repo root.

- `src/schema.ts:66-70` `Hook`: adding `failClosed?`, `dialect?` affects every converter that imports it: `claude.ts:12`, `copilot.ts:11`, `codex.ts:9`.
- `src/utils.ts:550-589` `generateDropItems`, `hooksFormatters` branch (`:584-586`): callers `cursor.ts:222`, `codex.ts:169`. Hook items move to `hookStatus`. Formatter items stay `dropped`.
- `src/converters/claude.ts`: `importHooks` `:205-231`; `buildHooksJson` `:333-356`; `exportSettings` `:380-393` (called at `:522`); formatter export `:347-353`.
- `src/converters/copilot.ts`: `importHooks` `:122-142`; `exportHooks` `:233-250`; `exactItems("hook")` `:324`.
- `src/converters/codex.ts`: `importHooks` `:34-61`; `exportHooks` `:65-88`; `exactItems` `:180`.
- `src/converters/opencode.ts:611-623`: hook item.
- `src/converters/cursor.ts:173,199,222-224`: capability, import, drop; new export added.
- `src/compare.ts:48`: keys hooks by event (open decision 4 if `Event(matcher)` names are adopted).
- `src/matrix.ts:43`: hook row; README matrix regenerates with `npm run docs:matrix`.
- Tests: `tests/capabilities.test.ts:51,249-260` (rewritten); `tests/permission-names.test.ts:184-193` (formatter assertion changes); 15 test files reference hooks, listed by `grep -rl hook tests`.

**Do not touch:** `permissionStatus` (`src/utils.ts:523-545`) and every permission write path, including `claude.ts:532` and the permission arms of each exporter. `writeIfNotDry` call sites keep their signature. The Claude import of `.claude/settings.json` permissions is unchanged.

**Overlaps with open changes (must be sequenced):**
- `capability-matrix/proposal.md:26,70` changes the OpenCode hook item from `lossy` to `dropped`. This change makes the same item `blocked`. Same line, conflicting outcomes.
- `conversion-matrix/proposal.md:23` changes the Claude formatter item in `claude.ts`. This change changes the same formatter export.
- `conversion-reporting` spec is also modified by `capability-matrix`, `conversion-matrix`, `fidelity-core`, and `safe-writes`. This change adds to it.

## Impact

- **On-disk output**: new `.cursor/hooks.json` and one wrapper file per guardrail under `.cursor/`. Copilot `hooks.json` shape changes. Claude `.claude/settings.json` is not written by this change except for the formatter command (open decision 3).
- **CLI**: a conversion containing a guardrail that cannot be enforced exits non-zero. Exit-code wiring in `src/index.ts` is not yet read [UNVERIFIED].
- **Runtime dependency**: the Cursor wrapper needs a runtime on the user's machine. Cursor does not document which runtimes are guaranteed [UNVERIFIED]. Windows runs hook commands through PowerShell (Cursor docs).
- **Security**: a guardrail is never dropped silently. A deny is never emitted as an allow. The wrapper fails closed on invalid output. Off-target guardrails that cannot be enforced stop the run.
- **Dependencies**: none added to `package.json`.
- **Consumers**: users who converted Claude guardrails to OpenCode or Copilot will see failing runs or a changed Copilot file.

## Open decisions (need the user)

1. **Overlaps**: sequence this change after `capability-matrix` and `conversion-matrix`, or merge the conflicting items into this change? Recommended: sequence after both.
2. **Wrapper language**: Node (needs Node on the user's PATH under Cursor) or POSIX `sh` (does not run under Windows PowerShell)? Recommended: Node, with the runtime requirement reported.
3. **Formatter command**: change the Claude formatter export to read stdin (D7), or leave it as-is in this change? Recommended: change it, since the current `$FILEPATH` argument is not defined by Claude. This edits the Claude output the user asked to keep.
4. **Scope**: one change for all five harnesses (the P0–P6 plan), or Cursor and the blocked rule now, with Copilot and Codex in a follow-up? Recommended: Cursor and the blocked rule now.

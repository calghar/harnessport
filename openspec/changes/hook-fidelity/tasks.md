## 1. BDD barrier (land first)

- [x] 1.1 Generate and run the BDD barrier before any code task (recorded in
      `tmp/barrier-1-1-cucumber.log`, EXIT=1 with undefined steps, and `tmp/barrier-1-1-vitest.log`,
      379 passed; the six preserved scenarios were confirmed GREEN in the final cucumber run,
      `tmp/t1-cucumber.log`, 65 passed):
      `uv run --no-project --script ~/.claude/tools/openspec-bdd.py generate --change hook-fidelity`
      (name every in-flight change),
      commit the generated `.feature` files for `specs/hook-guardrails/spec.md` and
      `specs/cursor-hook-wrapper/spec.md`, run `npx vitest run`, and record the result. Every new
      scenario must be RED, except the preserved-behaviour scenarios ("Formatters on opencode are
      unchanged", "A plain command hook is emitted unchanged", "A copilot file written by 0.2.1 still
      imports", "A codex Bash hook is emitted unchanged", "A legacy $FILEPATH formatter still
      imports", "Cursor formatters stay dropped"), which must be GREEN. No implementation task starts
      before this is recorded.

## 2. P1: hookStatus helper, OpenCode blocked

- [ ] 2.1 `src/schema.ts:66-70` `Hook`: add `failClosed?: boolean`, `timeout?: number`,
      `args?: string[]`, `dialect?: "claude" | "copilot"`. `npm run typecheck` stays green.
- [ ] 2.2 `src/utils.ts`, after `:545`: add `GUARDRAIL_EVENTS` and
      `hookStatus(hook, targetName, limitation, phase = "export")`. `blocked` for a guardrail event,
      `dropped` otherwise. `permissionStatus` (`:523-545`) is not edited.
- [ ] 2.3 `src/utils.ts:550-589` `generateDropItems`: replace `hooksFormatters` (`:557`, `:584-586`)
      with `hooks?` (through `hookStatus`) and `formatters?` (`dropped`).
- [ ] 2.4 `src/converters/opencode.ts:611-623`: replace the inline item with `hookStatus`, reason
      naming `tool.execute.before`.
- [x] 2.5 (Superseded: the interim `hooks: "Cursor hooks not yet converted"` text was replaced by
      task 6.3 before it was committed; `src/converters/cursor.ts` carries no such text.)
- [x] 2.6 `tests/capabilities.test.ts`: "A claude PreToolUse hook exported to opencode is blocked"
      (exit `2`) and "A claude PostToolUse hook exported to opencode is dropped" (exit `0`).
      Spec side: `specs/conversion-reporting/spec.md` removes "A dropped hook does not fail the run"
      (it expected exit `0`) and adds "A PreToolUse hook fails the opencode run".
- [x] 2.7 Regression per `generateDropItems` caller, each exporting to a real temp directory:
      `tests/hooks.test.ts` "cursor reports no agent, skill, command or mcp item as dropped" and
      "codex drops agents, commands and mcp servers, and writes no agent body".
- [ ] 2.8 `npx vitest run -t "A guardrail a target cannot write or enforce is blocked"` green.

## 3. P2: Claude import carries onFailure, if, timeout, args

- [ ] 3.1 `src/converters/claude.ts:194-199` `HooksJson` and `:331` `HookEntry`: add `type`, `args`,
      `timeout`, `onFailure`, `if`.
- [ ] 3.2 `src/converters/claude.ts:205-231` `importHooks`: map `onFailure: "block"` to `failClosed`,
      carry `timeout` and `args`, push a `lossy` import item for `if`, and route non-command `type`
      through `hookStatus(..., "import")` without creating a hook.
- [ ] 3.3 `src/converters/claude.ts:333-356` `buildHooksJson`: write `onFailure: "block"`, `timeout`,
      `args` when set. A hook without them emits `{type: "command", command}` as today.
- [ ] 3.4 `src/converters/claude.ts:529`: hooks with `dialect` other than `claude` go through
      `hookStatus`. Others stay `exact`.
- [x] 3.5 Test in `tests/hooks.test.ts`: export to a real temp directory, read `.claude/settings.json`
      back, assert the round-trip ("round-trips onFailure, timeout and args") and the unchanged
      plain-hook shape ("emits a plain command hook as {type, command} only").
- [ ] 3.6 Test: "Existing Claude settings are not removed or rewritten", both scenarios, comparing file
      bytes before and after.
- [ ] 3.7 `npx vitest run -t "Claude hook fields are carried or reported on import"` green.

## 4. P3: Copilot file shape and matcher

- [ ] 4.1 `src/converters/copilot.ts:114-120` `extractCommandFromHandler`: return
      `{command, matcher, timeout}` with `timeout = timeoutSec ?? timeout`.
- [ ] 4.2 `src/converters/copilot.ts:122-142` `importHooks`: unwrap `{version, hooks}`, keep the bare
      form, map camelCase keys to Claude events with `dialect: "copilot"`.
- [ ] 4.3 `src/converters/copilot.ts:233-250` `exportHooks`: write `{version: 1, hooks}`, key by
      dialect, write `matcher` and `timeoutSec`, translate PostToolUse matchers, report
      `UserPromptSubmit`, `PermissionRequest`, `args` and unknown PostToolUse tokens through
      `hookStatus` or `dropped`.
- [ ] 4.4 `src/converters/copilot.ts:324`: replace `exactItems("hook", …)` with the per-hook items
      from 4.3. Apply open-question defaults 7 (`failClosed` guardrail `blocked`) and 8 (PreToolUse
      `lossy`, reason naming `hookSpecificOutput`) unless the user decides otherwise.
- [x] 4.5 `tests/fixtures/copilot-project/.github/hooks/hooks.json`: keep the bare file for the
      0.2.1-import scenario. (Amended: no second fixture file. `matrix.test.ts` and
      `verify-check.test.ts` import every `.json` in that directory, so one would change their
      results. The dialect scenarios write the wrapped camelCase file inline, step at
      `features/step_definitions/copilot-hooks.steps.ts:56`.)
- [ ] 4.6 Test: export to a real temp directory and read `.github/hooks/hooks.json` back for every
      Copilot scenario.
- [x] 4.7 (Amended: covered in cucumber, not vitest.) `npx cucumber-js features/hook-guardrails.feature`
      green for requirements "Copilot hooks file has the documented shape and keeps matcher and
      timeout" and "A hook written for another dialect is not exported as if it were Claude-shaped".
      Vitest side: `tests/hooks.test.ts` "writes a Copilot hooks file at version 1".

## 5. P4: Codex matcher and failClosed

- [ ] 5.1 `src/converters/codex.ts:65-88` `exportHooks`: write a hook only when every matcher token is
      `Bash` (or `*`, empty, absent) and it has no `failClosed` or `args`. Return per-hook items.
      `timeout` makes a written hook `lossy`.
- [ ] 5.2 `src/converters/codex.ts:180`: replace `exactItems("hook", …)` with the items from 5.1.
- [ ] 5.3 Test: export to a real temp directory, read `.codex/hooks.json` back, assert the Bash hook is
      byte-identical to the 0.2.1 output.
- [x] 5.4 (Amended: covered in cucumber, not vitest.) `npx cucumber-js features/hook-guardrails.feature`
      green for requirement "Codex hooks report matchers and fail-closed settings they cannot
      honour". Vitest side: `tests/hooks.test.ts` "writes only Bash-matcher Codex hooks".

## 6. P5: Cursor wrapper (Node) and .cursor/hooks.json, Claude formatter runner

- [ ] 6.1 `src/converters/cursor.ts`: add the wrapper template constant and `exportHooks`. Write
      `.cursor/hooks/harnessport-guard-<n>.mjs` and `.cursor/hooks.json` through `writeIfNotDry`
      (`src/utils.ts:281`). Matcher map, event rules and item reasons (`node`, `runs twice`) per
      `specs/cursor-hook-wrapper/spec.md`.
- [ ] 6.2 `src/converters/cursor.ts:205-245` `export`: call `exportHooks`. Nothing under `.claude/` is
      written.
- [ ] 6.3 `src/converters/cursor.ts:222-224`: drop the interim `hooks` key from 2.5. Keep
      `formatters`. `src/converters/cursor.ts:173`: capability `hook: "full"`.
- [ ] 6.4 Wrapper tests in `tests/cursor-wrapper.test.ts`: write the wrapper to a temp directory, run
      it with `node` and a stub command per row of the mapping table, and assert stdout, stderr and
      exit code. Covers every scenario of "The wrapper maps the command's result" and "The wrapper
      renames `Shell` to `Bash`".
- [x] 6.5 `tests/capabilities.test.ts`: "declares hook as full" asserts cursor `hook: "full"`; the
      generic matrix test ("every converter declares each feature and agrees with its own export")
      checks it against the export. (The file has no never-reports list to edit.)
- [ ] 6.6 `src/converters/claude.ts:347-353` formatter branch: write
      `node "$CLAUDE_PROJECT_DIR/.claude/hooks/harnessport-format.mjs" <command>`.
      `src/converters/claude.ts:380-393` `exportSettings`: write the runner when formatters exist.
- [ ] 6.7 `src/converters/claude.ts:173-184` `isFormatterHook` and `:219-224`: detect the marker
      `harnessport-format.mjs` and the legacy `$FILEPATH`. Strip either to recover the command.
- [ ] 6.8 `src/converters/claude.ts:416-429` `formatterItem`: `dropped` for a command with `"`, `'`,
      `|`, `&`, `;`, `$`, `<`, `>` or a backtick.
- [ ] 6.9 `tests/permission-names.test.ts:184-193`: update the expected command to the runner form.
      Add a runner test that runs the emitted `.mjs` with stdin and a recording stub.
- [x] 6.10 Test: export claude to cursor into a real temp directory, read `.cursor/hooks.json` and the
      wrapper back, and assert the byte-identical re-run: `tests/cursor-wrapper.test.ts`
      "converts a claude export into hooks.json and the wrapper, byte-identical on re-run".
- [ ] 6.11 `npx vitest run -t "Cursor"` and `-t "The Claude formatter reads the edited file path"` green.

## 7. P6: docs, README matrix, CHANGELOG

- [ ] 7.1 `npm run docs:matrix` to regenerate the matrix at `README.md:20`. `npm run docs:check` green.
- [ ] 7.2 `README.md:217` by hand: Cursor `.cursor/hooks.json` with Node wrappers, Copilot
      `.github/hooks/*.json` with `version: 1`. Add a "Hook fidelity" paragraph: the
      guardrail set, the blocked rule, the Cursor double run.
- [ ] 7.3 `CHANGELOG.md:8` `[Unreleased]`: `### Security` entry: guardrails a target cannot write or
      enforce are `blocked` (exit `2`), OpenCode PreToolUse now fails the run, Copilot
      file gains `{version: 1, hooks}` with `matcher` and `timeoutSec` (re-run conversions made with
      0.2.1), Claude `onFailure: "block"` is carried. `### Added`: Cursor hooks through a Node
      wrapper. `### Changed`: Claude formatter reads the path from stdin.
- [ ] 7.4 `openspec validate hook-fidelity --strict` exits `0`.
- [ ] 7.5 `npm run check` green.
- [x] 7.6 (Run: `tmp/t1-cli-*.log`; exits cursor `0`, copilot `0`, opencode `2`, opencode to claude
      `0`; runner command read back from `.claude/settings.json`.) Real CLI run on a temp copy of `tests/fixtures/sample-project`, whose
      `.claude/settings.json` holds only a `$FILEPATH` formatter. Add a PreToolUse `Bash` guardrail
      to the copy. Run `npm run dev -- convert --from claude --to <t> --source <copy> --target <out-t>`
      for `cursor`, `copilot` and `opencode`. Read back `.cursor/hooks.json`, the wrapper,
      `.github/hooks/hooks.json`, and the exit codes (`0`, `0`, `2`). Then run
      `--from opencode --to claude` on the opencode output and read back the runner command in
      `.claude/settings.json`.

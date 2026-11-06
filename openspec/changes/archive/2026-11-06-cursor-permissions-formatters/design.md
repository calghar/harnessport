## Context

Cursor's CLI reads `allow` and `deny` rules from `<project>/.cursor/cli.json` (project) and `~/.cursor/cli-config.json` (global). Rule forms: `Shell(commandBase)`, `Read(glob)`, `Write(glob)`, `WebFetch(domain)`, `Mcp(server:tool)`. `Shell` matches the first token of the command, so `Shell(git)` covers every git subcommand (source: https://cursor.com/docs/cli/reference/permissions).

Cursor runs `afterFileEdit` hooks after an edit, with stdin `{"file_path": "<absolute path>", "edits": [...]}`. Project hooks run from the project root (source: https://cursor.com/docs/agent/hooks).

Constraints:
- `src/converters/cursor.ts` writes `.cursor/hooks.json` for `preToolUse` wrappers today. Its `preToolUse` output must not change.
- `writeIfNotDry` is the only file writer. A differing existing file is refused.
- `permissionStatus` (utils.ts) is the single enforcement point for permission writes: an action the target lacks is `dropped` for allow and `blocked` otherwise.
- The Claude formatter runner (`.claude/hooks/harnessport-format.mjs`) is byte-identical after the move.

## Goals / Non-Goals

**Goals**
- Export Claude `Bash` deny rules and shell-free formatters to Cursor, with fidelity reported per item.
- Import harnessport's own formatter entries back from Cursor.
- Never write a Cursor allow broader than its Claude source, and never write a Cursor deny narrower than its Claude source.

**Non-Goals**
- Permission import from `cli.json` (open question 1 resolved as "keep none, export deny").
- `Read`, `Write`, `WebFetch`, and `Mcp` allow or deny export. Their Cursor matching is not verified.
- The Cursor global file `~/.cursor/cli-config.json`. harnessport never writes it (user-level target writes skip permissions and say so).
- Changes to the OpenCode, Copilot, or Codex converters (see the verification findings in Open Questions).

## Decisions

**D1. Permission target is the project file `.cursor/cli.json`.**
Rationale: the project file is documented, and it is the repo-scoped location harnessport converts into. Alternative `~/.cursor/cli-config.json` would mutate a user-global file that holds unrelated settings.
- User-level target (`rootDir == homeDir`): permissions are not written. Each permission item is `dropped` with reason naming `~/.cursor/cli-config.json`.

**D2. Mapping table.** The exporter maps each `PermissionEntry` as follows. `base` is the first whitespace token of the pattern.

| Claude entry | action | Cursor result | Item status |
|---|---|---|---|
| `Bash`, pattern `*` | allow | `permissions.allow` gets `Shell(*)` | exact |
| `Bash`, pattern `*` | deny | `permissions.deny` gets `Shell(*)` | exact |
| `Bash`, pattern `<p>` | deny | `permissions.deny` gets `Shell(<base>)` | lossy |
| `Bash`, pattern `<p>` | allow | nothing written | dropped |
| `Read`/`Write`/`Edit`/`WebFetch`/other tool | deny | nothing written | blocked |
| any tool | allow (non-Bash) | nothing written | dropped |
| any tool | ask | nothing written | blocked (`permissionStatus`) |

`Edit` maps to Cursor `Write` only for the blocked-deny case, so the reason names `Edit`.

Why `Shell(*)` is exact: the doc says `Shell` "Supports glob patterns", so `*` covers every base. This is an assumption, recorded as open question 2.

**D3. Blocked items keep their reason text.** Reasons come from `permissionStatus`, or a new reason for deny where Cursor matching is unverified: "Cursor's `<tool>` matching is not verified to be no narrower than this deny, so the rule was not written".

**D4. Formatter export shape.** Each writable formatter becomes an `afterFileEdit` entry. The runner is `.cursor/hooks/harnessport-format.mjs`, and the command is `node <relative runner> "<glob>" <command>` for project targets, or the absolute quoted path for user-level targets (same rule as the wrapper).
- The runner reads `file_path` at the top level of stdin. The Claude runner reads `tool_input.file_path`. One source builder with a parameter for that field keeps the two byte-exact (D5).

**D5. Shared runner module.** New `src/converters/formatter-runner.ts` holds `FORMAT_RUNNER_MARKER`, `SHELL_SYNTAX`, `shellSyntaxIn`, `writableFormatters`, `formatterItem`, and `formatRunnerSource(fileField)`. `claude.ts` imports them. `formatRunnerSource("tool_input?.file_path")` reproduces the current Claude string exactly, verified by the existing claude-formatter steps and a byte-compare test.

**D6. One `hooks.json` write.** `exportHooks` builds `{version: 1, hooks: {preToolUse?: [...], afterFileEdit?: [...]}}` and writes once. Items for formatters are emitted only when the write succeeds. If the write is refused, each formatter item is `blocked` (fixes the reporting gap in the spec).

**D7. Import.** `importHooks` reads `.cursor/hooks.json`. Each `afterFileEdit` entry whose command contains the marker is parsed with the same regex the Claude importer uses (`parseRunnerCommand`, moved to the shared module). Other `afterFileEdit` entries produce an import item `dropped` on kind `hook`, name `afterFileEdit`.

**D8. Capability.** `permission` stays `none` (open question 1, decided). `formatter` becomes `full`. The capability test asserts `full` iff the export writes exact or lossy items. The `everyFeature()` fixture has permission `bash npm run:*` allow, which is dropped, so the test stays green with `none`.

## Risks / Trade-offs

- **[R1] Claude formatter runner byte drift** → D5 byte-compare test; claude-formatter steps stay green.
- **[R2] `hooks.json` refusal leaves the preToolUse guardrail unwritten while its item says `exact`** → Existing behaviour for `preToolUse` (the hook item is pushed before the write). Mitigation for formatters only, per D6. The `preToolUse` gap is recorded below, not fixed here.
- **[R3] Cursor deny `Shell(<base>)` blocks more than Claude** (e.g. Claude `git push *` deny blocks `git status`) → Reported `lossy`; exit stays 0. Accepted: a deny that over-blocks is safe, and the item says so.
- **[R4] Claude and Cursor both run the formatter when Cursor's Third-Party Imports is on** → Formatters run twice. Formatters are normally idempotent. Not reported in this change; recorded in Open Questions.
- **[R5] `Shell(*)` allow exactness** → Assumption (open question 2). If Cursor does not match `*` as a full wildcard, the exact item overstates. Mitigation: the BDD scenario asserts the item status, not Cursor's runtime behaviour, so the assumption stays visible.
- **[R6] Other callers** (`capabilities.test.ts`, `fidelity.test.ts`, `cursor-wrapper.test.ts`, `hooks.test.ts`, `claude-rules.test.ts`, `import-robustness.test.ts`) → each stays green by construction; the tasks re-run them after each unit.

## Migration Plan

- Deployment: release note under `[Unreleased]` says Cursor targets gain `.cursor/cli.json` and `.cursor/hooks/harnessport-format.mjs`, and `.cursor/hooks.json` gains `afterFileEdit`.
- Existing Cursor output with a differing `hooks.json` is refused, as before. Users re-run with `--force`, which keeps `.bak`.
- Rollback: revert the commit. Generated files stay on disk; harnessport never reads them back except through the importer, which then reads them as before.

## Open Questions

1. **Resolved (user):** permission capability stays `none`; deny rules are exported; permission import is a follow-up.
2. **Assumption, open:** `Shell(*)` covers every command in Cursor. Confirm by running `cursor-agent` with a `Shell(*)` deny in a scratch project, or accept the doc wording. Default: accept, and state it in the release note.
3. **Pre-existing, not in this change:** `exportHooks` pushes `preToolUse` hook items as `exact`/`lossy` before the `hooks.json` write, so a refused write leaves a false `exact`. Fix in a follow-up change with the same D6 treatment.
4. **Verification findings for other harnesses** (from `tmp/verify-opencode.md`, `tmp/verify-copilot.md`, `tmp/verify-codex.md`):
   - OpenCode: `websearch` is a documented permission key (https://opencode.ai/docs/permissions). The 0.2.0 changelog line "OpenCode has no `websearch` permission key" is wrong. `UNREPRESENTABLE_TOOLS` in `src/converters/opencode.ts` is wrong. Allow stays dropped, deny stays blocked, so no permission is widened; the reason text and exit code are wrong. Also wrong: `lsp` is non-granular; `list` is not a key; `domain:` rewrite; `hook: none` ignores plugins with `tool.execute.before`.
   - Copilot: CLI has `permissions-config.json` and `allowedUrls`/`deniedUrls` settings, so `permission: none` is wrong for CLI. `permissionRequest` exists on CLI. A `preToolUse` hook exiting `2` denies and is fail-closed, so the "cannot block" reason at `copilot.ts:292-293` is wrong. Project MCP is `.mcp.json` or `.github/mcp.json`, not `.copilot/mcp-config.json`.
   - Codex: `permission: none` is wrong. `prefix_rule` decisions `allow`, `prompt`, `forbidden` apply to shell commands (execpolicy README). Hook `timeout` exists, so the "no verified timeout" reason is wrong. Codex docs site was unreachable; evidence is the openai/codex repo. Rules file location and scope unverified.
   - Each is a separate follow-up change. None is fixed here.

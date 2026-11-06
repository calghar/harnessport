## 1. Barrier

- [x] 1.1 Run `uv run --no-project --script ~/.claude/tools/openspec-bdd.py generate` with every in-flight change named (`capability-matrix`, `claude-rule-scoping`, `conversion-matrix`, `fidelity-core`, `hook-fidelity`, `safe-writes`, `verify-and-check`, `cursor-permissions-formatters`); run cucumber-js; record the split. Preserved scenarios pass; every new ADDED scenario of this change is undefined or red.

## 2. Shared formatter runner (declarative first)

- [x] 2.1 Create `src/converters/formatter-runner.ts` with `FORMAT_RUNNER_MARKER`, `SHELL_SYNTAX`, `shellSyntaxIn`, `writableFormatters`, `formatterItem`, `formatRunnerSource(fileField)`, `parseRunnerCommand`; `claude.ts` imports them and drops its copies.
- [x] 2.2 Add a byte-compare test: `formatRunnerSource("tool_input?.file_path")` equals the Claude runner source produced before this change. Regression guard for Claude callers.
- [x] 2.3 Regression: `tests/hooks.test.ts`, the claude-formatter steps, and `tests/claude-rules.test.ts` pass unchanged.

- [x] 2.4 Write `features/step_definitions/cursor-permissions-formatters.steps.ts` for every scenario in `specs/cursor-permissions-formatters/spec.md`. Steps call the real exporter and importer on temp directories; they do not reimplement the mapping.

## 3. Permission export

- [x] 3.1 In `src/converters/cursor.ts`, implement the D2 mapping; write `.cursor/cli.json` with `permissions.allow` and `permissions.deny` through `writeIfNotDry`; skip with `dropped` items when the target is the home directory.
- [x] 3.2 Make the permission scenarios pass: allow dropped, `Shell(*)` exact, deny `Shell(<base>)` lossy, Read/Edit/WebFetch deny blocked, ask blocked, refused `cli.json` blocks its items.
- [x] 3.3 Regression: `tests/fidelity.test.ts` and `tests/permission-names.test.ts` pass with no assertion change.

## 4. Formatter export and single hooks.json write

- [x] 4.1 Restructure `exportHooks` so `preToolUse` and `afterFileEdit` share one `hooks.json` write (D6); write `.cursor/hooks/harnessport-format.mjs` with `formatRunnerSource("file_path")`; formatter items come from `formatterItem` and turn `blocked` when the write is refused.
- [x] 4.2 Make the formatter-export scenarios pass, including the shell-free and shell-needing cases and the runner glob-match examples.
- [x] 4.3 Regression: `tests/cursor-wrapper.test.ts` and the cursor-wrapper steps pass, and the `preToolUse` wrapper files and entries are byte-identical to before.

## 5. Formatter import

- [x] 5.1 `importHooks` in `cursor.ts` reads `afterFileEdit` entries: runner entries become formatters through `parseRunnerCommand`; other entries become `dropped` import items; `permissions` stays empty.
- [x] 5.2 Make the import scenarios pass: round-trip and foreign entry.
- [x] 5.3 Regression: `tests/claude-rules.test.ts` round trip and `tests/import-robustness.test.ts` pass.

## 6. Capability, docs, changelog

- [x] 6.1 Set `formatter: "full"` in the Cursor capabilities; keep `permission: "none"`; run `npm run docs:matrix`; confirm README diff is the formatter cell only.
- [x] 6.2 `CHANGELOG.md` `[Unreleased]`: one entry under `### Added` for Cursor formatter export and import, and permission export to `.cursor/cli.json`. The other-harness findings go in their own changes.

## 7. Gates

- [x] 7.1 Haiku gate agent runs `npm run check` and `npm run bdd`; log under `tmp/`; reply SUCCESS or FAILURE; lead reads the `EXIT=` line.
- [x] 7.2 `openspec validate cursor-permissions-formatters --strict` exits 0.
- [ ] 7.3 Commit and archive only after user approval (not done in this change).

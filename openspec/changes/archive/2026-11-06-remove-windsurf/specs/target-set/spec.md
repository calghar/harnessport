## ADDED Requirements

### Requirement: The supported targets are five harnesses

The CLI SHALL accept exactly these harness names as `--from` and `--to`: `claude`, `opencode`, `cursor`, `copilot`, `codex`. The `list` command SHALL print the display name of each of these five harnesses: `Claude Code`, `OpenCode`, `Cursor`, `Copilot`, `Codex CLI`. The `detect` command SHALL print the same five ids it accepts.

#### Scenario: Windsurf is not a target
- **GIVEN** a source project holding `.claude/settings.json`
- **WHEN** running `convert --from claude --to windsurf --source <dir> --target <out>`
- **THEN** the process exits `1`
- **AND** stderr names `windsurf` as an unknown target and lists `claude, opencode, cursor, copilot, codex`
- **AND** `<out>` is not created

#### Scenario: Windsurf is not a source
- **GIVEN** a directory holding `.windsurf/rules/a.md`
- **WHEN** running `convert --from windsurf --to claude --source <dir> --target <out>`
- **THEN** the process exits `1`
- **AND** stderr names `windsurf` as an unknown source

#### Scenario: list omits Windsurf
- **WHEN** running `list`
- **THEN** stdout contains each of `Claude Code`, `OpenCode`, `Cursor`, `Copilot`, `Codex CLI`
- **AND** stdout does not contain `windsurf`

#### Scenario: Existing user Windsurf files are left alone
- **GIVEN** a target directory holding `.windsurf/rules/keep.md` with content `keep`
- **WHEN** running `convert --from claude --to cursor --source <dir> --target <target>` into that directory
- **THEN** `.windsurf/rules/keep.md` still holds `keep`

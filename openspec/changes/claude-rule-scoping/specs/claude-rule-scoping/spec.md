## ADDED Requirements

### Requirement: Every documented Claude instruction location is read

Importing from claude SHALL read `./CLAUDE.md`, `./.claude/CLAUDE.md`, `./CLAUDE.local.md`, and
every `.md` file under `.claude/rules/`, including nested directories. A repository using any one
of these SHALL be detected.

#### Scenario: A root CLAUDE.md is found
- **GIVEN** a repository holding `./CLAUDE.md` and no `.claude/` directory
- **WHEN** detecting harnesses
- **THEN** claude is detected

#### Scenario: A root CLAUDE.md is imported
- **GIVEN** a repository holding `./CLAUDE.md`
- **WHEN** importing from claude
- **THEN** the config holds a rule whose content is that file's content

#### Scenario: Both instruction locations are read together
- **GIVEN** a repository holding both `./CLAUDE.md` and `./.claude/CLAUDE.md`
- **WHEN** importing from claude
- **THEN** the config holds two rules

#### Scenario: A local instruction file is imported
- **GIVEN** a repository holding `./CLAUDE.local.md`
- **WHEN** importing from claude
- **THEN** the config holds a rule whose content is that file's content

#### Scenario: A repository is detected by any of its Claude directories
- **GIVEN** a repository whose only Claude configuration is `<dir>`
- **WHEN** detecting harnesses
- **THEN** claude is detected

#### Examples:
| dir               |
|-------------------|
| .claude/skills    |
| .claude/agents    |
| .claude/commands  |
| .claude/rules     |

### Requirement: File-scoped rules keep their scope

A `.claude/rules/*.md` file carrying `paths:` frontmatter SHALL import as a rule whose `globs`
holds those patterns. A rule carrying a glob SHALL export to `.claude/rules/<name>.md` with a
`paths:` list, not be merged into the always-on instructions file.

#### Scenario: paths frontmatter imports as globs
- **GIVEN** a repository holding `.claude/rules/api.md` with `paths:` of `src/api/**/*.ts`
- **WHEN** importing from claude
- **THEN** the config holds a rule whose globs include `src/api/**/*.ts`

#### Scenario: A glob-scoped rule exports to .claude/rules
- **GIVEN** a config holding a rule with globs `src/**/*.ts` and source `typescript.mdc`
- **WHEN** exporting to claude
- **THEN** `.claude/rules/typescript.md` is written
- **AND** its frontmatter `paths` contains `src/**/*.ts`

#### Scenario: An unscoped rule stays in the instructions file
- **GIVEN** a config holding a rule with no globs
- **WHEN** exporting to claude
- **THEN** no file is written under `.claude/rules/`
- **AND** the rule content appears in the instructions file

#### Scenario: Multiple globs survive as a list
- **GIVEN** a config holding a rule whose globs are `src/**/*.ts,lib/**/*.ts`
- **WHEN** exporting to claude
- **THEN** the emitted `paths` frontmatter holds two entries

#### Scenario: Cursor glob scoping survives a round trip through claude
- **GIVEN** a cursor repository holding a rule with globs `src/**/*.ts`
- **WHEN** converting from cursor to claude, then from claude back to cursor
- **THEN** the resulting cursor rule still has globs `src/**/*.ts`

#### Scenario: A scoped rule is reported exact rather than lossy
- **GIVEN** a config holding a rule with globs `src/**/*.ts`
- **WHEN** exporting to claude
- **THEN** the rule's item status is `exact`

### Requirement: The instructions file does not duplicate an existing one

Where the target repository already holds `./CLAUDE.md`, unscoped rules SHALL be written there.
Otherwise they SHALL be written to `.claude/CLAUDE.md`. A conversion SHALL NOT produce both files,
because Claude Code loads both and the content would be duplicated.

#### Scenario: An existing root file is the target
- **GIVEN** a target repository already holding `./CLAUDE.md`
- **WHEN** exporting unscoped rules to claude
- **THEN** no `.claude/CLAUDE.md` is written

#### Scenario: A clean target uses the .claude directory
- **GIVEN** a target repository holding no instruction file
- **WHEN** exporting unscoped rules to claude
- **THEN** `.claude/CLAUDE.md` is written
- **AND** no `./CLAUDE.md` is written

### Requirement: Scoping that cannot be represented is reported precisely

Claude Code activates a rule by path, not by description. A rule carrying only a description and no
glob SHALL be reported `lossy`, naming the description as the part that could not be preserved. A
rule carrying a glob SHALL NOT be reported lossy on that account.

#### Scenario: A description-activated rule is reported lossy
- **GIVEN** a config holding a rule with a description and no globs
- **WHEN** exporting to claude
- **THEN** that rule's item status is `lossy`
- **AND** its reason mentions the description

#### Scenario: A plain rule is reported exact
- **GIVEN** a config holding a rule with no globs and no description
- **WHEN** exporting to claude
- **THEN** that rule's item status is `exact`

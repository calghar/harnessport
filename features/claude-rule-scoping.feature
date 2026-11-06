Feature: claude-rule-scoping

  # Requirement: Every documented Claude instruction location is read
  # Importing from claude SHALL read `./CLAUDE.md`, `./.claude/CLAUDE.md`, `./CLAUDE.local.md`, and every `.md` file under `.claude/rules/`, including nested directories. A repository using any one of these SHALL be detected.

  @requirement_every_documented_claude_instruction_location_is_read
  Scenario: A root CLAUDE.md is found
    Given a repository holding `./CLAUDE.md` and no `.claude/` directory
    When detecting harnesses
    Then claude is detected

  @requirement_every_documented_claude_instruction_location_is_read
  Scenario: A root CLAUDE.md is imported
    Given a repository holding `./CLAUDE.md`
    When importing from claude
    Then the config holds a rule whose content is that file's content

  @requirement_every_documented_claude_instruction_location_is_read
  Scenario: Both instruction locations are read together
    Given a repository holding both `./CLAUDE.md` and `./.claude/CLAUDE.md`
    When importing from claude
    Then the config holds two rules

  @requirement_every_documented_claude_instruction_location_is_read
  Scenario: A local instruction file is imported
    Given a repository holding `./CLAUDE.local.md`
    When importing from claude
    Then the config holds a rule whose content is that file's content

  @requirement_every_documented_claude_instruction_location_is_read
  Scenario Outline: A repository is detected by any of its Claude directories
    Given a repository whose only Claude configuration is `<dir>`
    When detecting harnesses
    Then claude is detected

    Examples:
      | dir              |
      | .claude/skills   |
      | .claude/agents   |
      | .claude/commands |
      | .claude/rules    |

  # Requirement: File-scoped rules keep their scope
  # A `.claude/rules/*.md` file carrying `paths:` frontmatter SHALL import as a rule whose `globs` holds those patterns. A rule carrying a glob SHALL export to `.claude/rules/<name>.md` with a `paths:` list, not be merged into the always-on instructions file.

  @requirement_file_scoped_rules_keep_their_scope
  Scenario: paths frontmatter imports as globs
    Given a repository holding `.claude/rules/api.md` with `paths:` of `src/api/**/*.ts`
    When importing from claude
    Then the config holds a rule whose globs include `src/api/**/*.ts`

  @requirement_file_scoped_rules_keep_their_scope
  Scenario: A glob-scoped rule exports to .claude/rules
    Given a config holding a rule with globs `src/**/*.ts` and source `typescript.mdc`
    When exporting to claude
    Then `.claude/rules/typescript.md` is written
    And its frontmatter `paths` contains `src/**/*.ts`

  @requirement_file_scoped_rules_keep_their_scope
  Scenario: An unscoped rule stays in the instructions file
    Given a config holding a rule with no globs
    When exporting to claude
    Then no file is written under `.claude/rules/`
    And the rule content appears in the instructions file

  @requirement_file_scoped_rules_keep_their_scope
  Scenario: Multiple globs survive as a list
    Given a config holding a rule whose globs are `src/**/*.ts,lib/**/*.ts`
    When exporting to claude
    Then the emitted `paths` frontmatter holds two entries

  @requirement_file_scoped_rules_keep_their_scope
  Scenario: Cursor glob scoping survives a round trip through claude
    Given a cursor repository holding a rule with globs `src/**/*.ts`
    When converting from cursor to claude, then from claude back to cursor
    Then the resulting cursor rule still has globs `src/**/*.ts`

  @requirement_file_scoped_rules_keep_their_scope
  Scenario: A scoped rule is reported exact rather than lossy
    Given a config holding a rule with globs `src/**/*.ts`
    When exporting to claude
    Then the rule's item status is `exact`

  # Requirement: The instructions file does not duplicate an existing one
  # Where the target repository already holds `./CLAUDE.md`, unscoped rules SHALL be written there. Otherwise they SHALL be written to `.claude/CLAUDE.md`. A conversion SHALL NOT produce both files, because Claude Code loads both and the content would be duplicated.

  @requirement_the_instructions_file_does_not_duplicate_an_existing_one
  Scenario: An existing root file is the target
    Given a target repository already holding `./CLAUDE.md`
    When exporting unscoped rules to claude
    Then no `.claude/CLAUDE.md` is written

  @requirement_the_instructions_file_does_not_duplicate_an_existing_one
  Scenario: A clean target uses the .claude directory
    Given a target repository holding no instruction file
    When exporting unscoped rules to claude
    Then `.claude/CLAUDE.md` is written
    And no `./CLAUDE.md` is written

  # Requirement: Scoping that cannot be represented is reported precisely
  # Claude Code activates a rule by path, not by description. A rule carrying only a description and no glob SHALL be reported `lossy`, naming the description as the part that could not be preserved. A rule carrying a glob SHALL NOT be reported lossy on that account.

  @requirement_scoping_that_cannot_be_represented_is_reported_precisely
  Scenario: A description-activated rule is reported lossy
    Given a config holding a rule with a description and no globs
    When exporting to claude
    Then that rule's item status is `lossy`
    And its reason mentions the description

  @requirement_scoping_that_cannot_be_represented_is_reported_precisely
  Scenario: A plain rule is reported exact
    Given a config holding a rule with no globs and no description
    When exporting to claude
    Then that rule's item status is `exact`

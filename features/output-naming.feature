Feature: output-naming

  # Requirement: Two inputs never collapse onto one output file
  # Where two items would derive the same output filename, the names SHALL be disambiguated so each item gets its own file, and each disambiguation SHALL be reported as a `lossy` item naming the original and the path actually used.

  @requirement_two_inputs_never_collapse_onto_one_output_file
  Scenario: Skills differing only by case each get a file
    Given a config holding skills named `Testing` and `testing`
    When exporting to any harness that writes skills
    Then two distinct `SKILL.md` files are written
    And both skill bodies are present on disk

  @requirement_two_inputs_never_collapse_onto_one_output_file
  Scenario: Skills differing only by separator each get a file
    Given a config holding skills named `code review` and `code-review`
    When exporting to any harness that writes skills
    Then two distinct `SKILL.md` files are written

  @requirement_two_inputs_never_collapse_onto_one_output_file
  Scenario: A disambiguation is reported
    Given a config holding two skills whose names slugify identically
    When exporting
    Then a `lossy` item is reported naming the collision

  @requirement_two_inputs_never_collapse_onto_one_output_file
  Scenario: Rules without a source name do not collapse
    Given a config holding three rules that each have a glob and no source filename
    When exporting to copilot
    Then three distinct `.instructions.md` files are written

  # Requirement: A formatter keeps its own identity
  # A formatter's emitted name SHALL derive from its own command. Distinct commands SHALL NOT be mapped onto one shared name, and two formatters SHALL NOT collapse into a single entry.

  @requirement_a_formatter_keeps_its_own_identity
  Scenario: Two Python formatters both survive
    Given a config holding a `black` formatter and an `isort` formatter
    When exporting to opencode
    Then `opencode.json` holds two formatter entries
    And neither entry's command contradicts its name

  @requirement_a_formatter_keeps_its_own_identity
  Scenario Outline: A formatter's name reflects its command
    Given a config holding a formatter whose command is `<command>`
    When exporting to opencode
    Then the emitted formatter key is `<name>`

    Examples:
      | command  | name     |
      | black    | black    |
      | isort    | isort    |
      | ruff     | ruff     |
      | prettier | prettier |
      | gofmt    | gofmt    |

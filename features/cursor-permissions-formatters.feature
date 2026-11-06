Feature: cursor-permissions-formatters

  # Requirement: Cursor permission export never widens an allow
  # The Cursor exporter SHALL write a Claude permission entry to `.cursor/cli.json` only when the written Cursor rule matches no more commands or paths than the entry.

  @requirement_cursor_permission_export_never_widens_an_allow
  Scenario Outline: A Bash allow with a pattern is dropped
    Given a canonical permission with tool `Bash`, pattern `<pattern>`, action `allow`
    When the Cursor exporter exports the config into an empty project
    Then the item for `Bash(<pattern>)` has status `dropped`
    And `.cursor/cli.json` is not written

    Examples:
      | pattern     |
      | git push *  |
      | npm test    |
      | rm -rf dist |

  @requirement_cursor_permission_export_never_widens_an_allow
  Scenario: A Bash allow for every command is exact
    Given a canonical permission with tool `Bash`, pattern `*`, action `allow`
    When the Cursor exporter exports the config into an empty project
    Then the item for `Bash(*)` has status `exact`
    And `.cursor/cli.json` holds `Shell(*)` in `permissions.allow`

  # Requirement: Cursor permission export never narrows a deny
  # The Cursor exporter SHALL write a Claude `deny` only as a Cursor rule that matches every command or path the Claude rule matches, and SHALL block the entry when no such rule is verified.

  @requirement_cursor_permission_export_never_narrows_a_deny
  Scenario Outline: A Bash deny with a pattern becomes a command-base deny
    Given a canonical permission with tool `Bash`, pattern `<pattern>`, action `deny`
    When the Cursor exporter exports the config into an empty project
    Then the item for `Bash(<pattern>)` has status `lossy`
    And its reason says the deny covers every command with the same first token
    And `.cursor/cli.json` holds `Shell(<base>)` in `permissions.deny`

    Examples:
      | pattern     | base |
      | git push *  | git  |
      | rm -rf dist | rm   |
      | npm run:*   | npm  |

  @requirement_cursor_permission_export_never_narrows_a_deny
  Scenario Outline: A deny on a path or domain tool is blocked
    Given a canonical permission with tool `<tool>`, pattern `<pattern>`, action `deny`
    When the Cursor exporter exports the config into an empty project
    Then the item for `<tool>(<pattern>)` has status `blocked`
    And `.cursor/cli.json` is not written for it

    Examples:
      | tool     | pattern          |
      | Read     | .env             |
      | Edit     | secrets/**       |
      | WebFetch | domain:evil.test |

  @requirement_cursor_permission_export_never_narrows_a_deny
  Scenario: A user-level target blocks a deny instead of dropping it
    Given a canonical permission with tool `Bash`, pattern `rm -rf dist`, action `deny`
    When the Cursor exporter exports the config with the target equal to the home directory
    Then the item for `Bash(rm -rf dist)` has status `blocked`
    And `.cursor/cli.json` is not written

  @requirement_cursor_permission_export_never_narrows_a_deny
  Scenario: An ask rule is blocked
    Given a canonical permission with tool `Bash`, pattern `git push *`, action `ask`
    When the Cursor exporter exports the config into an empty project
    Then the item for `Bash(git push *)` has status `blocked`
    And the item's reason states that the `ask` rule is refused rather than written as an allow

  # Requirement: Cursor formatter export runs through afterFileEdit
  # The Cursor exporter SHALL write each formatter whose glob and command contain none of the characters `"`, `'`, `|`, `&`, `;`, `$`, `<`, `>`, or a backtick, as an `afterFileEdit` entry in `.cursor/hooks.json` that runs `.cursor/hooks/harnessport-format.mjs` with the formatter's glob and command. A formatter containing any of those characters SHALL be reported dropped.

  @requirement_cursor_formatter_export_runs_through_afterfileedit
  Scenario: A shell-free formatter is written
    Given a canonical formatter with glob `*.py` and command `ruff format`
    When the Cursor exporter exports the config into an empty project
    Then the item for `*.py` has status `lossy`
    And its reason names Third-Party Imports
    And `.cursor/hooks.json` holds an `afterFileEdit` entry whose command runs `.cursor/hooks/harnessport-format.mjs "*.py" ruff format`
    And `.cursor/hooks/harnessport-format.mjs` exists

  @requirement_cursor_formatter_export_runs_through_afterfileedit
  Scenario: A formatter that needs a shell is dropped
    Given a canonical formatter with glob `*.ts` and command `prettier --write | tee log`
    When the Cursor exporter exports the config into an empty project
    Then the item for `*.ts` has status `dropped`
    And no `afterFileEdit` entry is written for it

  @requirement_cursor_formatter_export_runs_through_afterfileedit
  Scenario Outline: The runner passes the edited file only when its glob matches
    Given the runner written for glob `*.py` and command `ruff format`
    When Cursor sends an `afterFileEdit` payload whose `file_path` is `<file>`
    Then the formatter command runs on `<file>` when `<runs>` is `yes`, and does not run when `<runs>` is `no`

    Examples:
      | file           | runs |
      | src/app.py     | yes  |
      | docs/readme.md | no   |

  # Requirement: Cursor formatter import reads harnessport's afterFileEdit entries
  # The Cursor importer SHALL import each `afterFileEdit` entry that runs the harnessport formatter runner as a canonical formatter, and SHALL report every other `afterFileEdit` entry as dropped.

  @requirement_cursor_formatter_import_reads_harnessport_s_afterfileedit_entries
  Scenario: A harnessport formatter entry round-trips
    Given `.cursor/hooks.json` written by the Cursor exporter for glob `*.py` and command `ruff format`
    When the Cursor importer imports the project
    Then the canonical formatters hold glob `*.py` and command `ruff format`

  @requirement_cursor_formatter_import_reads_harnessport_s_afterfileedit_entries
  Scenario: A foreign afterFileEdit entry is reported, not imported
    Given `.cursor/hooks.json` with an `afterFileEdit` entry whose command is `./audit.sh`
    When the Cursor importer imports the project
    Then the canonical formatters are empty
    And the import items hold a dropped hook item for `afterFileEdit`

  # Requirement: Cursor hooks file holds both events in one write
  # The Cursor exporter SHALL write `.cursor/hooks.json` once, holding `preToolUse` entries and `afterFileEdit` entries together.

  @requirement_cursor_hooks_file_holds_both_events_in_one_write
  Scenario: Guardrails and formatters share one hooks file
    Given a canonical config with one PreToolUse guardrail and one shell-free formatter
    When the Cursor exporter exports the config into an empty project
    Then `.cursor/hooks.json` holds a `preToolUse` array and an `afterFileEdit` array
    And the PreToolUse guardrail's wrapper is still written as before

  # Requirement: Existing Cursor permission and hook files are never clobbered
  # The Cursor exporter SHALL refuse to replace an existing `.cursor/cli.json` or `.cursor/hooks.json` whose content differs, unless `--force` is given, which SHALL keep a `.bak` copy.

  @requirement_existing_cursor_permission_and_hook_files_are_never_clobbered
  Scenario: A differing cli.json is refused and its permission items are blocked
    Given an existing `.cursor/cli.json` with content `{"permissions":{"allow":["Shell(ls)"],"deny":[]}}`
    When the Cursor exporter exports a config with one Bash deny `rm -rf dist`, without `--force`
    Then `.cursor/cli.json` keeps its content
    And the item for `.cursor/cli.json` has status `blocked`
    And the item for `Bash(rm -rf dist)` has status `blocked`, not `lossy`

  @requirement_existing_cursor_permission_and_hook_files_are_never_clobbered
  Scenario: A refused hooks.json blocks its formatter items
    Given an existing `.cursor/hooks.json` with content `{"version":1,"hooks":{"afterFileEdit":[{"command":"./audit.sh"}]}}`
    When the Cursor exporter exports a config with one shell-free formatter `*.py` `ruff format`, without `--force`
    Then `.cursor/hooks.json` keeps its content
    And the item for `*.py` has status `blocked`, not `exact`

  @requirement_existing_cursor_permission_and_hook_files_are_never_clobbered
  Scenario: A refused hooks.json blocks the PreToolUse guardrail
    Given an existing `.cursor/hooks.json` with content `{"version":1,"hooks":{"afterFileEdit":[{"command":"./audit.sh"}]}}`
    When the Cursor exporter exports a config with one PreToolUse guardrail (Bash, command `./guard.sh`), without `--force`
    Then the item for the guardrail (kind `hook`, name `PreToolUse`) has status `blocked`
    And `.cursor/hooks.json` keeps its content

  # Requirement: Cursor permissions are not imported
  # The Cursor importer SHALL return no permissions, even when `.cursor/cli.json` holds rules.

  @requirement_cursor_permissions_are_not_imported
  Scenario: A cli.json with rules imports no permissions
    Given `.cursor/cli.json` with `permissions.allow` holding `Shell(ls)`
    When the Cursor importer imports the project
    Then the canonical permissions are empty

Feature: cursor-hook-roundtrip

  Scenario: Read guard imports once
    Given Cursor hooks generated from one Claude Read guard
    When the Cursor converter imports them
    Then one canonical PreToolUse Read hook is returned

  Scenario: Foreign hook is reported
    Given a foreign Cursor preToolUse hook
    When the Cursor converter imports it
    Then the foreign hook is reported dropped

  Scenario Outline: Standalone Cursor configuration is detected
    Given a directory containing only `<file>`
    When harnessport detects Cursor
    Then Cursor is detected

    Examples:
      | file               |
      | .cursor/cli.json   |
      | .cursor/hooks.json |

  Scenario: Stale generated wrapper is removed
    Given a previous conversion wrote an extra generated wrapper
    When the current conversion runs with force
    Then only the stale generated wrapper is removed

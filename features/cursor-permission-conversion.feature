Feature: cursor-permission-conversion

  Scenario: Home permissions replace only permission arrays
    Given a Cursor user config with model settings and a Cursor-only allow rule
    When Claude permissions are exported to the home directory with force
    Then model settings remain and permission arrays contain only mapped Claude rules

  Scenario: Cursor permission import
    Given a Cursor permission file holding allow and deny tokens
    When the Cursor converter imports it
    Then canonical permissions carry each action tool and pattern

  Scenario Outline: Permission export matrix
    When a Claude `<action>` permission `<source>` is exported to Cursor
    Then the target token is `<target>` with fidelity `<status>`

    Examples:
      | action | source               | target              | status  |
      | deny   | Read(.env*)          | Read(.env*)         | exact   |
      | deny   | Write(**/*.key)      | Write(**/*.key)     | exact   |
      | deny   | WebFetch(evil.test)  | WebFetch(evil.test) | exact   |
      | deny   | mcp__jira__delete(*) | Mcp(jira:delete)    | exact   |
      | allow  | Bash(claude *)       | Shell(claude:*)     | exact   |
      | allow  | WebSearch(*)         | (absent)            | dropped |

  Scenario: Matching MCP call asks
    Given a Claude ask permission for mcp__jira__jira_post
    When Cursor sends beforeMCPExecution for jira jira_post
    Then the MCP wrapper asks

  Scenario: Unrelated MCP call passes
    Given a Claude ask permission for mcp__jira__jira_post
    When Cursor sends beforeMCPExecution for another tool
    Then the MCP wrapper allows

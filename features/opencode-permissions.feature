Feature: opencode-permissions

  # Requirement: WebSearch is written as the websearch key
  # The OpenCode exporter SHALL write a `WebSearch` permission with pattern `*` as the `websearch` key under `permission` in `opencode.json`, carrying the entry's action. It SHALL report the entry `exact`.

  @requirement_websearch_is_written_as_the_websearch_key
  Scenario: An allowed WebSearch is written
    Given a canonical config holding a `WebSearch` permission with pattern `*` and action `allow`
    When exporting to opencode into a temp directory
    Then `opencode.json` holds `permission.websearch` equal to `allow`
    And the `permission` item named `WebSearch(*)` has status `exact`

  @requirement_websearch_is_written_as_the_websearch_key
  Scenario: A denied WebSearch is written as deny
    Given a canonical config holding a `WebSearch` permission with pattern `*` and action `deny`
    When exporting to opencode into a temp directory
    Then `opencode.json` holds `permission.websearch` equal to `deny`
    And the `permission` item named `WebSearch(*)` has status `exact`

  @requirement_websearch_is_written_as_the_websearch_key
  Scenario: An ask WebSearch is written as ask
    Given a canonical config holding a `WebSearch` permission with pattern `*` and action `ask`
    When exporting to opencode into a temp directory
    Then `opencode.json` holds `permission.websearch` equal to `ask`

  # Requirement: A shorthand-only key carries the strictest action
  # For a permission key OpenCode accepts only as one action (`webfetch`, `websearch`, `lsp`, `list`), the exporter SHALL write the strictest action among the entries written for it (`deny`, then `ask`, then `allow`). A `deny` or `ask` with a pattern other than `*` SHALL be reported `blocked` and not written.

  @requirement_a_shorthand_only_key_carries_the_strictest_action
  Scenario: lsp is written as a string
    Given a canonical config holding an `lsp` permission with pattern `*` and action `deny`
    When exporting to opencode into a temp directory
    Then `opencode.json` holds `permission.lsp` equal to the string `deny`

  @requirement_a_shorthand_only_key_carries_the_strictest_action
  Scenario: A patterned deny on lsp is blocked
    Given a canonical config holding an `lsp` permission with pattern `src/*` and action `deny`
    When exporting to opencode into a temp directory
    Then the `permission` item named `lsp(src/*)` has status `blocked`
    And `opencode.json` has no `lsp` permission key

  @requirement_a_shorthand_only_key_carries_the_strictest_action
  Scenario: list is not granular
    Given a canonical config holding a `list` permission with pattern `src/*` and action `ask`
    When exporting to opencode into a temp directory
    Then the `permission` item named `list(src/*)` has status `blocked`

  @requirement_a_shorthand_only_key_carries_the_strictest_action
  Scenario: The strictest action wins
    Given a canonical config holding `WebFetch` permissions `allow` and `deny`, both with pattern `*`
    When exporting to opencode into a temp directory
    Then `opencode.json` holds `permission.webfetch` equal to `deny`

  # Requirement: A domain pattern is reported unsupported
  # The exporter SHALL NOT rewrite a `domain:` pattern into a URL pattern. A permission whose pattern starts with `domain:` SHALL NOT be written. It SHALL be reported `dropped` when its action is `allow` and `blocked` when `ask` or `deny`.

  @requirement_a_domain_pattern_is_reported_unsupported
  Scenario: A denied domain is blocked
    Given a canonical config holding a `WebFetch` permission with pattern `domain:evil.test` and action `deny`
    When exporting to opencode into a temp directory
    Then the `permission` item named `WebFetch(domain:evil.test)` has status `blocked`
    And `opencode.json` does not contain `https://evil.test`

  @requirement_a_domain_pattern_is_reported_unsupported
  Scenario: An allowed domain is dropped
    Given a canonical config holding a `WebFetch` permission with pattern `domain:github.com` and action `allow`
    When exporting to opencode into a temp directory
    Then the `permission` item named `WebFetch(domain:github.com)` has status `dropped`
    And `opencode.json` has no `webfetch` permission key

  # Requirement: A hook reason names the OpenCode plugin path
  # The reason on an OpenCode hook item SHALL NOT claim OpenCode has no mechanism besides the formatter. It SHALL name plugins on `tool.execute.before` as the OpenCode path and state that harnessport does not generate them.

  @requirement_a_hook_reason_names_the_opencode_plugin_path
  Scenario: A PreToolUse reason names plugins
    Given a canonical config holding a hook on event `PreToolUse`
    When exporting to opencode
    Then the item of kind `hook` has a reason containing `plugin` and `tool.execute.before`
    And the reason does not contain `supports only formatters`

  # Requirement: Documented formatter fields are imported or reported
  # The OpenCode importer SHALL skip a formatter entry with `disabled: true` and report it `dropped` in the import items. It SHALL report a formatter entry carrying `environment` as `lossy`, and still import its command.

  @requirement_documented_formatter_fields_are_imported_or_reported
  Scenario: A disabled formatter is not imported as active
    Given an `opencode.json` holding a formatter `prettier` with `disabled` true and a `command`
    When importing from opencode
    Then the config holds no formatter
    And the import item of kind `formatter` named `prettier` has status `dropped`

  @requirement_documented_formatter_fields_are_imported_or_reported
  Scenario: A formatter environment is reported lossy
    Given an `opencode.json` holding a formatter `prettier` with `environment` `{"A":"1"}`, a `command` and `extensions`
    When importing from opencode
    Then the config holds one formatter
    And the import item of kind `formatter` named `prettier` has status `lossy`

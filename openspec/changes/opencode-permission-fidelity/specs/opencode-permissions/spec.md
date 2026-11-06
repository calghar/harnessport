# Delta for OpenCode Permissions

## ADDED Requirements

### Requirement: WebSearch is written as the websearch key

The OpenCode exporter SHALL write a `WebSearch` permission with pattern `*` as the `websearch` key under `permission` in `opencode.json`, carrying the entry's action. It SHALL report the entry `exact`.

#### Scenario: An allowed WebSearch is written
- **GIVEN** a canonical config holding a `WebSearch` permission with pattern `*` and action `allow`
- **WHEN** exporting to opencode into a temp directory
- **THEN** `opencode.json` holds `permission.websearch` equal to `allow`
- **AND** the `permission` item named `WebSearch(*)` has status `exact`

#### Scenario: A denied WebSearch is written as deny
- **GIVEN** a canonical config holding a `WebSearch` permission with pattern `*` and action `deny`
- **WHEN** exporting to opencode into a temp directory
- **THEN** `opencode.json` holds `permission.websearch` equal to `deny`
- **AND** the `permission` item named `WebSearch(*)` has status `exact`

#### Scenario: An ask WebSearch is written as ask
- **GIVEN** a canonical config holding a `WebSearch` permission with pattern `*` and action `ask`
- **WHEN** exporting to opencode into a temp directory
- **THEN** `opencode.json` holds `permission.websearch` equal to `ask`

### Requirement: A shorthand-only key carries the strictest action

For a permission key OpenCode accepts only as one action (`webfetch`, `websearch`, `lsp`, `list`), the exporter SHALL write the strictest action among the entries written for it (`deny`, then `ask`, then `allow`). A `deny` or `ask` with a pattern other than `*` SHALL be reported `blocked` and not written.

#### Scenario: lsp is written as a string
- **GIVEN** a canonical config holding an `lsp` permission with pattern `*` and action `deny`
- **WHEN** exporting to opencode into a temp directory
- **THEN** `opencode.json` holds `permission.lsp` equal to the string `deny`

#### Scenario: A patterned deny on lsp is blocked
- **GIVEN** a canonical config holding an `lsp` permission with pattern `src/*` and action `deny`
- **WHEN** exporting to opencode into a temp directory
- **THEN** the `permission` item named `lsp(src/*)` has status `blocked`
- **AND** `opencode.json` has no `lsp` permission key

#### Scenario: list is not granular
- **GIVEN** a canonical config holding a `list` permission with pattern `src/*` and action `ask`
- **WHEN** exporting to opencode into a temp directory
- **THEN** the `permission` item named `list(src/*)` has status `blocked`

#### Scenario: The strictest action wins
- **GIVEN** a canonical config holding `WebFetch` permissions `allow` and `deny`, both with pattern `*`
- **WHEN** exporting to opencode into a temp directory
- **THEN** `opencode.json` holds `permission.webfetch` equal to `deny`

### Requirement: A domain pattern is reported unsupported

The exporter SHALL NOT rewrite a `domain:` pattern into a URL pattern. A permission whose pattern starts with `domain:` SHALL NOT be written. It SHALL be reported `dropped` when its action is `allow` and `blocked` when `ask` or `deny`.

#### Scenario: A denied domain is blocked
- **GIVEN** a canonical config holding a `WebFetch` permission with pattern `domain:evil.test` and action `deny`
- **WHEN** exporting to opencode into a temp directory
- **THEN** the `permission` item named `WebFetch(domain:evil.test)` has status `blocked`
- **AND** `opencode.json` does not contain `https://evil.test`

#### Scenario: An allowed domain is dropped
- **GIVEN** a canonical config holding a `WebFetch` permission with pattern `domain:github.com` and action `allow`
- **WHEN** exporting to opencode into a temp directory
- **THEN** the `permission` item named `WebFetch(domain:github.com)` has status `dropped`
- **AND** `opencode.json` has no `webfetch` permission key

### Requirement: A hook reason names the OpenCode plugin path

The reason on an OpenCode hook item SHALL NOT claim OpenCode has no mechanism besides the formatter. It SHALL name plugins on `tool.execute.before` as the OpenCode path and state that harnessport does not generate them.

#### Scenario: A PreToolUse reason names plugins
- **GIVEN** a canonical config holding a hook on event `PreToolUse`
- **WHEN** exporting to opencode
- **THEN** the item of kind `hook` has a reason containing `plugin` and `tool.execute.before`
- **AND** the reason does not contain `supports only formatters`

### Requirement: Documented formatter fields are imported or reported

The OpenCode importer SHALL skip a formatter entry with `disabled: true` and report it `dropped` in the import items. It SHALL report a formatter entry carrying `environment` as `lossy`, and still import its command.

#### Scenario: A disabled formatter is not imported as active
- **GIVEN** an `opencode.json` holding a formatter `prettier` with `disabled` true and a `command`
- **WHEN** importing from opencode
- **THEN** the config holds no formatter
- **AND** the import item of kind `formatter` named `prettier` has status `dropped`

#### Scenario: A formatter environment is reported lossy
- **GIVEN** an `opencode.json` holding a formatter `prettier` with `environment` `{"A":"1"}`, a `command` and `extensions`
- **WHEN** importing from opencode
- **THEN** the config holds one formatter
- **AND** the import item of kind `formatter` named `prettier` has status `lossy`

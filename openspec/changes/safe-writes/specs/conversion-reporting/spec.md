## ADDED Requirements

### Requirement: Malformed input is distinguishable from absent input

Reading a config file SHALL distinguish a file that is not present from one that is present but
unreadable or malformed. An absent file SHALL yield an empty result. A file that exists but cannot
be parsed or read SHALL be reported as a `blocked` import item naming the path and the reason, and
SHALL NOT be reported as an empty result.

#### Scenario: A malformed JSON config is reported, not silently empty
- **GIVEN** a source directory holding a `.mcp.json` containing invalid JSON
- **WHEN** importing from claude
- **THEN** a `blocked` item with phase `import` naming `.mcp.json` is reported

#### Scenario: A malformed config fails the run
- **GIVEN** a source directory holding a `.mcp.json` containing invalid JSON
- **WHEN** converting from claude
- **THEN** the process exits `2`

#### Scenario: An absent config is not an error
- **GIVEN** a source directory with no `.mcp.json`
- **WHEN** importing from claude
- **THEN** no item names `.mcp.json`
- **AND** the config holds no MCP servers

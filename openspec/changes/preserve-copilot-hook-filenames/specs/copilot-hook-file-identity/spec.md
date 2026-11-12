## ADDED Requirements

### Requirement: Copilot hook source files retain their identity
The system SHALL retain the basename of each `.github/hooks/*.json` file from which it imports a
Copilot hook entry. When that configuration is exported to Copilot, the system SHALL write each
entry to a file with its retained basename and SHALL keep entries from different source files
separate when the repository's existing target-file write policy permits the write.

#### Scenario: Two purpose-named files survive a Copilot round trip
- **WHEN** a Copilot source contains `policy.json` with a `preToolUse` entry and `audit.json` with a `postToolUse` entry
- **THEN** a Copilot export writes the `preToolUse` entry to `.github/hooks/policy.json`
- **AND** it writes the `postToolUse` entry to `.github/hooks/audit.json`
- **AND** it does not combine both entries in `.github/hooks/hooks.json`

#### Scenario: Entries from one source file stay grouped
- **WHEN** a Copilot source file `lifecycle.json` contains entries for `sessionStart` and `sessionEnd`
- **THEN** a Copilot export writes both entries to `.github/hooks/lifecycle.json`

#### Scenario: A legacy bare file keeps its basename
- **WHEN** a Copilot source file `guard.json` uses the accepted bare event-table shape
- **THEN** a Copilot export writes the imported entries to `.github/hooks/guard.json`
- **AND** the exported file uses the documented `version: 1` wrapper

#### Scenario: A different target file is not overwritten
- **WHEN** a Copilot source file `guard.json` is exported to a target whose `.github/hooks/guard.json` has different content
- **THEN** the existing target file remains unchanged
- **AND** the refused write is reported under the existing target-file write policy

### Requirement: Hooks without Copilot source-file identity use the default file
A hook with no retained Copilot source filename SHALL be exported to `.github/hooks/hooks.json`.

#### Scenario: A hook imported from Claude uses the default Copilot file
- **WHEN** a Claude hook is exported to Copilot
- **THEN** the hook is written to `.github/hooks/hooks.json`

#### Scenario: Named and unnamed hooks remain separate
- **WHEN** a Copilot export contains one hook retained from `policy.json` and one hook with no retained Copilot source filename
- **THEN** the retained hook is written to `.github/hooks/policy.json`
- **AND** the unnamed hook is written to `.github/hooks/hooks.json`

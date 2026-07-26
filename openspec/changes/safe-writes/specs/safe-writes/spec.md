## ADDED Requirements

### Requirement: An existing file is never silently overwritten

Writing SHALL compare the intended content against the file already at that path. Where the file
exists and its content differs, the write SHALL be refused, reported as a `blocked` item naming the
path, and the file on disk SHALL be left byte-for-byte unchanged.

#### Scenario: A differing file is left untouched
- **GIVEN** a target directory holding a hand-written `AGENTS.md` whose content differs from what the conversion would write
- **WHEN** converting into that directory without `--force`
- **THEN** `AGENTS.md` on disk is unchanged
- **AND** a `blocked` item naming `AGENTS.md` is reported

#### Scenario: A refused write fails the run
- **GIVEN** a target directory holding a differing existing file
- **WHEN** converting into that directory without `--force`
- **THEN** the process exits `2`

#### Scenario: A missing file is written normally
- **GIVEN** a target directory with no existing config
- **WHEN** converting into that directory
- **THEN** the files are written
- **AND** no item has status `blocked`

#### Scenario: Identical content is not rewritten
- **GIVEN** a target directory already holding exactly the content the conversion would write
- **WHEN** converting into that directory
- **THEN** no `blocked` item is reported
- **AND** the process exits `0`

#### Scenario: One conflict does not suppress other files
- **GIVEN** a target directory holding one differing file among several the conversion would write
- **WHEN** converting into that directory without `--force`
- **THEN** the non-conflicting files are still written

### Requirement: Forcing an overwrite preserves the original

`convert` SHALL accept a `--force` flag. Under `--force`, a conflicting file SHALL be copied to
`<path>.bak` before being overwritten, and the overwrite SHALL be reported as a `lossy` item naming
the backup.

#### Scenario: Force writes the new content and keeps a backup
- **GIVEN** a target directory holding a differing existing `AGENTS.md`
- **WHEN** converting into that directory with `--force`
- **THEN** `AGENTS.md` holds the newly converted content
- **AND** `AGENTS.md.bak` holds the original content

#### Scenario: Force succeeds where the unforced run refused
- **GIVEN** a target directory holding a differing existing file
- **WHEN** converting into that directory with `--force`
- **THEN** the process exits `0`
- **AND** a `lossy` item naming the backup path is reported

#### Scenario: Force does not create a backup where there was no conflict
- **GIVEN** a target directory with no existing config
- **WHEN** converting into that directory with `--force`
- **THEN** no file ending in `.bak` is written

### Requirement: A dry run writes nothing

`--dry-run` SHALL write no file, create no backup, and modify no existing file, while still
reporting the items a real run would report.

#### Scenario: Dry run leaves a conflicting file untouched and still reports it
- **GIVEN** a target directory holding a differing existing file
- **WHEN** converting into that directory with `--dry-run`
- **THEN** the existing file is unchanged
- **AND** a `blocked` item naming it is reported

#### Scenario: Dry run with force writes nothing
- **GIVEN** a target directory holding a differing existing file
- **WHEN** converting into that directory with both `--dry-run` and `--force`
- **THEN** the existing file is unchanged
- **AND** no `.bak` file exists

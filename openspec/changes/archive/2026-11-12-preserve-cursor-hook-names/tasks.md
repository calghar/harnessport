## 1. Executable contract

- [x] 1.1 Generate the naming scenarios and confirm they fail before implementation
- [x] 1.2 Add Cucumber step definitions for source names, collisions, fallback, and cleanup

## 2. Implementation

- [x] 2.1 Derive safe wrapper basenames from supported hook command forms
- [x] 2.2 Allocate deterministic unique wrapper names and update hook references
- [x] 2.3 Remove obsolete legacy and source-named wrappers during forced conversion

## 3. Propagation and verification

- [x] 3.1 Update unit tests and existing generated scenarios for the new filenames
- [x] 3.2 Add the release changelog entry and bump the patch version
- [x] 3.3 Run OpenSpec validation, generated-feature drift checks, and the repository check

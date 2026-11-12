# Requirements Analysis: Copilot hook file identity

## Stage 1: Refinement

| ID | Requirement | Status | Finding |
|---|---|---|---|
| R1 | Copilot hook source files retain their identity | KEPT | Names the input files, entry grouping, and observable exported paths without prescribing storage or implementation. |
| R2 | Hooks without Copilot source-file identity use the default file | KEPT | Defines the fallback for non-Copilot origins and mixed named/unnamed exports. |

## Stage 2: Consistency and Completeness

### Resolved conflict

The existing BDD text says the Copilot exporter writes `.github/hooks/hooks.json` for every hook.
That conflicts with R1. The approved filename-and-grouping behavior narrows the old rule: only hooks
without retained Copilot source-file identity use `hooks.json`.

### Completeness

R1 covers wrapped and accepted bare Copilot source files, multiple files, and multiple entries in one
file. It also defers existing-target conflicts to the repository's no-overwrite policy. R2 covers
hooks from other targets and mixed named/unnamed exports. Empty configurations and malformed source
files retain their existing behavior and are outside this naming change.

### Boundary scenarios

1. **ACCEPTED:** Two files contain the same event name. Each file remains separate.
2. **ACCEPTED:** One source file contains several events. Its entries remain grouped.
3. **ACCEPTED:** A retained `hooks.json` entry and an unnamed entry share the default output file.
4. **ACCEPTED:** A different existing purpose-named target file remains unchanged and the write is refused.
5. **REJECTED:** Empty purpose-named files are created while all entries move to `hooks.json`.
6. **REJECTED:** A non-Copilot-origin hook receives an invented purpose filename.

## Stage 3: Clarification Resolution

The user selected preservation of both filenames and source-file grouping. No clarification remains.

## Result

PASS. The requirements are testable, solution-free, unambiguous, consistent, and complete for the
declared scope.

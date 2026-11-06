## Context

Windsurf is one of six converters. Removing it touches the registry in `src/matrix.ts`, the matrix that generates the README, and tests that name it. Open changes in `openspec/changes/` also describe Windsurf and must match the five-target set.

## Decisions

1. **Delete the converter file.** `src/converters/windsurf.ts` is removed. Reason: no registry entry remains to load it. Keeping it dead would leave a code path that still compiles.
2. **Unregister in one place.** Remove `windsurfConverter` from the import and `ALL_CONVERTERS` in `src/matrix.ts`. `CONVERTERS` is derived from that list, so `index.ts` needs no edit.
3. **Tests lose Windsurf rows, not whole tests.** Each `["windsurf", ...]` row and each `windsurfConverter` case is deleted. Tests that loop over converters keep running for the other five.
4. **Windsurf-specific fidelity cases move to the target-set spec.** The `convert --to windsurf` exit-0 case in `tests/fidelity.test.ts:317-320` becomes the exit-1 case in `specs/target-set/spec.md`.
5. **Regenerate the matrix.** Run `npm run docs:matrix` after the registry change. Then hand-edit the README prose lines (`README.md:59,96,233` and the layout tree) that the generator does not own.
6. **Open changes are edited in place.** Windsurf rows are removed from their artifacts. Their scenarios stay unless they test Windsurf alone, in which case the scenario is removed with its requirement. Each edited change is validated with `openspec validate <name> --strict`.
7. **Regenerate BDD features after the artifact edits.** Run `openspec-bdd generate` with every in-flight change named, as the barrier requires.
8. **CHANGELOG under `[Unreleased]`.** A `### Removed` entry names the target and the exit-1 behaviour. Historical entries are not edited.

## Risks / Trade-offs

- Scripts that convert to Windsurf fail with exit 1 after this change. Accepted, and stated in the changelog.
- Open-change edits can miss a Windsurf reference. The completion check is a grep for `windsurf` (case-insensitive) with an allowlist of `CHANGELOG.md` history and this change's own files.

## Migration Plan

Users on 0.2.x who convert to Windsurf must drop the `--to windsurf` step. Their existing `.windsurf/` files are not touched.

## Open Questions

None. The user approved removal and editing the open changes on 2026-11-06.

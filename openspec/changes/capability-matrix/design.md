## Context

Three tables describe the same thing and none is derived from the others:

- `src/index.ts:205-238` — 24 hardcoded `console.log` lines behind `harnessport list`.
- `README.md:7-16` — a markdown support matrix.
- The six converters — the only one that is actually true, being the code that runs.

The CLI table is the most wrong: it reports `-` for Cursor agents (`cursor.ts:142-159` writes
them), Cursor skills and commands, and Copilot agents, skills, commands, MCP, and hooks
(`copilot.ts:192-250`). The README is closer but carries `partial` on cells where harnessport
converts nothing at all — Windsurf MCP, Codex agents, Codex permissions — which reads as "some of
it works".

Constraints this change lives under:

- **Emitted output is the product's contract.** No converted file, frontmatter key, filename, or
  directory may change. The `safe-writes` byte-identical guarantee across all six targets must
  still hold after this change.
- **`permissionActions` is enforcement; `capabilities` is documentation.** The never-weaken rule
  lives in `permissionStatus` (`src/utils.ts:517`) and must keep living only there.
- **The generated README region is generated.** Once markers are in, hand edits to that region are
  discarded by `docs:matrix` and rejected by `docs:check`.

## Goals / Non-Goals

**Goals:**

- One declaration per converter, and both tables rendered from it.
- Drift between declaration and behaviour fails `npm run check`, not a later bug report.
- Each value is truthful about what harnessport does, distinguishing "the harness has no such
  concept" from "the harness keeps it outside your repo, where we do not look".

**Non-Goals:**

- Implementing any missing capability. Windsurf agents and Codex commands stay unconverted; this
  change makes the tables say so.
- Reading user-level config (`~/.codex/config.toml`, `~/.codeium/windsurf/mcp_config.json`). Still
  out of scope per the plan; `user-level` is precisely the label for that gap.
- Import-direction verification. Asserting a declaration against import behaviour needs a fixture
  per source tool, which is Phase 5's work. This change verifies the export direction only, and
  says so.

## Decisions

**1. Three values, not a boolean, and not `full`/`partial`/`none`.**

Under a strict reading — `full` = converts both directions, `none` = neither — no cell in the repo
is one-directional, so `partial` would be an enum member with no members. An enum value that
cannot occur is dead code.

But collapsing to a boolean would throw away real information the README already carried: Windsurf
does have MCP servers, and Codex does have agents; they live in a file outside the repository. A
user reading `-` would conclude the harness lacks the feature, which is false. `user-level` says
the true thing in one word.

Rejected: keeping `partial` with the meaning "converts, but some inputs come back lossy". Nearly
every cell would qualify — Claude agents drop `mode` and `temperature`, OpenCode permissions block
shorthand denies — so it would carry no signal. That question is what the per-item fidelity report
answers, for the user's actual config, and duplicating it in a static table would put a second,
vaguer answer next to the precise one.

**2. Keyed by `Feature`, extracted from `FidelityItem["kind"]`.**

The eight features already exist as an inline union in `src/schema.ts:95-103`. Naming it and keying
`capabilities` by it means `Record<Feature, Capability>` is total by construction: adding a ninth
feature breaks all six converters at compile time until each declares it. Defining a second,
parallel list of feature names would let the two drift, which is the exact defect being fixed.

**3. The consistency test compares the declaration to fidelity items, not to file writes.**

The alternative — assert that exporting produces a file under the expected path — needs a
path-per-feature-per-tool table, which is a fourth hand-maintained table. Fidelity items are
already emitted per feature per converter and already carry the `exact`/`lossy`/`dropped`/`blocked`
distinction the declaration is about. `full` ⟺ some item is `exact` or `lossy`; `user-level`/`none`
⟺ every item is `dropped` or `blocked`.

This is what surfaces the one behaviour change in this proposal: the OpenCode exporter reports
hooks as `lossy` while writing nothing for them, so `opencode.hook` could be declared neither
`full` (nothing is written) nor `none` (an item claims otherwise). The declaration is `none` and
the item is corrected to `dropped`.

**4. Generator as a script with `--check`, not a vitest assertion.**

A test can detect drift but cannot fix it; the developer would hand-copy the table out of a
failure message. One `scripts/sync-readme.ts` both writes and verifies, so the fix is
`npm run docs:matrix`. It runs under the existing `tsx` devDependency — no new package.

**5. Marker-delimited region, not whole-file generation.**

`<!-- BEGIN:matrix -->` / `<!-- END:matrix -->` in `README.md`. The rest of the README stays
hand-written; generating the whole file would put prose under a generator.

## Risks / Trade-offs

**Per converter — does emitted output change?**

| Converter | Output changes? | Why |
|---|---|---|
| claude | No | Only a `capabilities` literal is added to the exported object. No function body is touched. |
| opencode | No | The `lossy` → `dropped` edit changes a `FidelityItem.status` string. No hook was ever written, so no file differs. |
| cursor | No | `capabilities` literal only. |
| windsurf | No | `capabilities` literal only. |
| copilot | No | `capabilities` literal only. |
| codex | No | `capabilities` literal only. |

- [A converter's declaration is written to match wishful thinking rather than code] → The
  consistency test runs the real exporter over a config holding one of every feature and fails on
  disagreement. A declaration cannot be aspirational and still pass.
- [`capabilities` gets consulted on the permission write path, and a documentation field starts
  gating security behaviour] → `permissionStatus(entry, targetActions, targetName)` receives no
  converter, so it structurally cannot read `capabilities`. `permissionActions` stays the sole
  input to that decision and is left untouched.
- [`src/schema.ts` is shared, so extracting `Feature` reaches all six converters] → The union's
  members are unchanged; `Feature` is an alias for exactly the existing inline union. The two
  consumers (`src/utils.ts:555`, `:586`) reference it as `FidelityItem["kind"]` and keep resolving
  to the same type. `npm run typecheck` covers this.
- [`tests/fidelity.test.ts:25` declares `Record<string, Converter>` and would break] → It builds
  that record from the six real converter objects, which all gain the field. Nothing there
  constructs a `Converter` literal, so nothing needs a new property.
- [The README drift check fails for contributors who edit the table by hand] → That is the
  intended behaviour; the failure message names `npm run docs:matrix`, and the markers make the
  generated region visibly generated.
- [`harnessport list` output changes for anyone scraping it] → It is documented as human-readable
  and always has been; `convert --json` is the scripting surface. The change is a correction —
  cells move from wrong to right — and it is recorded in the changelog.

## Migration Plan

No deployment order and no shim. This change adds a field to an interface that only this repository
implements, and adds two npm scripts.

- **Files written by an earlier version:** unaffected. No emitted format changes, so every file
  0.1.x or the `claude-rule-scoping` build wrote still parses identically, and re-running a
  conversion is not required. A user who re-runs gets byte-identical output, which the regression
  test in `tasks.md` asserts across all six targets.
- **Rollback:** pin `harnessport@0.1.2`. Files emitted by this version remain readable by it —
  nothing about the on-disk format differs between the two. The only loss on rollback is that
  `list` reverts to the incorrect matrix.

## Open Questions

None. One judgement call is recorded rather than left open: Codex CLI's `approval_policy` and
`sandbox_mode` live in `~/.codex/config.toml` and could arguably make `codex.permission`
`user-level`. They are declared `none`, because they are a sandbox/approval mode rather than a
tool-and-pattern permission list — there is no mapping from `PermissionEntry` onto them, so the
feature is absent rather than merely out of reach.

## Context

`tests/convert.test.ts` covers the Claude importer and five exporters, every one of them with
`dryRun: true`. That means the five non-Claude importers are never invoked, and the serialization
path never executes. The block named `round-trip: claude -> opencode -> claude` calls
`claudeConverter.import(FIXTURE)` and asserts `mcpServers.length === 2` on the result: no export,
no re-import, so it cannot fail for any conversion defect.

Constraints:

- **`permissionStatus` is the single never-weaken enforcement point** (`src/utils.ts:517`). Both
  permission fixes route through it rather than adding a second decision site.
- **Emitted layout is the contract.** The only emitted-bytes change in this design is the
  permission tool name inside `.claude/settings.local.json`, which is the defect.
- **Fixtures are inputs, not expectations.** A fixture must not be shaped to make a test pass. Two
  places where that temptation arose are recorded under Decisions.

## Goals / Non-Goals

**Goals:**

- All 30 ordered pairs exercised against real files, with assertions that can fail.
- The five untested importers covered by a fixture each.
- Every loss on every pair accounted for by a fidelity item — the property the whole positioning
  rests on, asserted rather than asserted-about.
- Test files type-checked (**M6**).

**Non-Goals:**

- Byte-exact expected-output fixtures. They pin formatting rather than meaning and turn every
  cosmetic change into 30 test edits. The assertions are semantic: detected, present, accounted
  for.
- Fixing the *cause* of every accounted-for loss. A loss that is correctly reported is working as
  designed; only losses reported as `exact` are defects here.

## Decisions

**1. Assert `to.detect(dir)` for every pair.**

"What harnessport writes for tool X is recognised as tool X configuration" is the weakest property
a converter must have, and nothing checked it. It caught a real edge immediately: `codex.detect`
requires `.codex/` to exist, so a rules-only config converted to Codex produces an undetectable
directory.

That edge is **not** worked around by giving every fixture a skill so `.codex/` gets created —
that would be shaping fixtures to pass. Each fixture holds a skill because a representative project
has one, and the rules-only case is covered by its own scenario in `capability-declaration`, which
exports a config holding one of every feature. The Codex behaviour is left as is: `AGENTS.md` alone
is genuinely ambiguous between OpenCode and Codex, and widening `codex.detect` to claim every
`AGENTS.md` repository is a larger question than this change.

**2. Compare inventories by the same name the fidelity item uses.**

The "everything lost is accounted for" assertion needs source names and item names to line up.
Permissions are compared as `Tool(pattern)` and formatters as their glob, matching
`permissionStatus` and `exactItems` exactly. Getting this alignment wrong produces false drift —
the first draft of the probe reported 26 losses, of which 22 were the probe's own key mismatch and
4 were real.

Permission tool comparison is case-insensitive, because OpenCode's config keys are legitimately
lowercase and a cross-harness comparison should not call that a loss. The separate question — that
a lowercase name written *into Claude* does not match — is fixed at the source by canonicalising on
import, not papered over in the comparison.

**3. Canonical permission tool names are Claude-style.**

`PermissionEntry.tool` is documented in `src/schema.ts:59` as `e.g. "Bash", "WebFetch",
"WebSearch"`, so the canonical form already exists; OpenCode's importer simply was not honouring
it. The map lives in `opencode.ts` beside `GRANULAR_PERMISSIONS`, because OpenCode's importer is
the only producer of non-canonical names. An unmapped key keeps its own name rather than being
guessed at.

Rejected: canonicalising in `buildSettingsLocalJson` on the Claude side. That fixes one consumer
and leaves the canonical config holding a name no other consumer can rely on.

**4. `WebSearch` routes through `permissionStatus`, not a second branch.**

OpenCode has no `websearch` permission key, which is why `buildPermissionConfig` filters it. That
makes it exactly the case `permissionStatus` exists for: `allow` → `dropped`, `ask`/`deny` →
`blocked`. Adding a bespoke branch in `partitionPermissions` would create a second place where a
permission's fate is decided, which is the thing the design has been avoiding since Phase 1.

**5. The Claude formatter classification is computed, not assumed.**

`inferGlobFromCommand(fmt.command) === fmt.glob` decides `exact` versus `lossy`. This reuses the
importer's own function, so the export's claim and the import's behaviour cannot disagree — if the
inference list gains an entry, the classification follows automatically.

## Risks / Trade-offs

**Per converter — does emitted output change?**

| Converter | Output changes? | Why |
|---|---|---|
| claude | Yes, from an OpenCode source only | `.claude/settings.local.json` carries `Bash(git push *)` where it carried `bash(git push *)`. The old form matched no Claude Code tool. No other file differs; the formatter fix changes a reported status, not the emitted hook. |
| opencode | No | `websearch` was already absent from the emitted config — only the reported status changes. `buildPermissionConfig` lowercases, so canonical input produces the same keys as before. |
| cursor | No | Not modified. |
| windsurf | No | Not modified. |
| copilot | No | Not modified. |
| codex | No | Not modified. |

- [Canonicalising tool names breaks `buildPermissionConfig`'s grouping] → It already calls
  `p.tool.toLowerCase()` at `opencode.ts:465` and compares lowercase in `isShorthandOnly` at
  `:413`, so canonical input groups identically. A regression scenario asserts the emitted key is
  still `bash`.
- [A `WebSearch` deny now exits 2 where it exited 0] → Intended. The rule was being discarded
  while the run reported success. Recorded in the changelog as a behaviour change.
- [The formatter fix flips `claude.formatter` away from `full`] → It does not. `full` requires at
  least one `exact` **or** `lossy` item, and `lossy` qualifies. The `capabilities` test covers
  this and stays green.
- [Type-checking `tests/` surfaces pre-existing errors] → It surfaces `__dirname`, which is not
  defined in an ESM package and works only because vitest transpiles it. Replaced with
  `fileURLToPath(import.meta.url)`, which also works on Node 18 — `import.meta.dirname` does not,
  and CI runs 18.
- [30 pairs × several assertions is slow] → Measured: the probe over all 30 pairs with real
  directory writes runs in well under a second. Vitest's existing suite is ~1s total.

## Migration Plan

- **Files written by an earlier version:** a `.claude/settings.local.json` produced from an
  OpenCode source holds permission entries that Claude Code never matched. Re-running the
  conversion rewrites them; because the content differs, the safe-write rule refuses and reports
  it, so `--force` is required and a `.bak` is kept. That is the correct amount of friction for
  overwriting a file the user may have edited.
- **Everything else:** unchanged, no re-run required.
- **Rollback:** pin `harnessport@0.1.2`. Files emitted by this version remain readable by it. The
  only difference is that permission entries become ones Claude Code actually matches, which the
  older version would still read and write back unchanged.

## Open Questions

None blocking. One question is deliberately deferred rather than answered: whether `codex.detect`
should recognise a bare `AGENTS.md`. Doing so would make every OpenCode repository also detect as
Codex, which may be correct — both read that file — but it changes `detect` output for existing
users and belongs in its own change.

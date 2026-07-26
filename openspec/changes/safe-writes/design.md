## Context

`writeIfNotDry` (`src/utils.ts:203-211`) is the only place in `src/` that calls `fs.writeFileSync` —
grep-confirmed, one occurrence. Every exporter routes through it. That invariant is what makes this
change tractable: conflict detection has exactly one enforcement point and no converter can bypass it.

Its current signature takes `dryRun: boolean` and returns `void`; all 22 call sites follow the shape

```ts
writeIfNotDry(filePath, content, dryRun);
files.push(filePath);
```

so a refused write would still be reported as written unless the result is threaded back.

Constraints:

- Emitted paths, layout, and content are frozen. This change decides *whether* a write happens.
- The `fidelity-core` item model is settled; this change adds items, it does not reshape them.
- `tests/fixtures/sample-project/` is frozen.

## Goals / Non-Goals

**Goals**

- No existing file is overwritten without either identical content or explicit `--force`.
- `--force` never destroys the original without a `.bak`.
- Two inputs never collapse onto one output path.
- A malformed config is distinguishable from an absent one.

**Non-Goals**

- Rule scoping and `.claude/rules/` (Phase 3).
- The capability matrix as data (Phase 4).
- Merging agent bodies into rules for Windsurf and Codex. See Decisions.
- A `--backup-dir` or configurable backup naming. `<path>.bak` until someone asks.

## Decisions

**A `WriteContext` replaces the `dryRun` boolean rather than adding a parameter.** `dryRun` is
already threaded to all 22 sites, so widening that one parameter into
`{ dryRun, force, items, written }` reuses the existing plumbing instead of adding a parallel
channel. `writeIfNotDry` returns `boolean` so callers guard their `files.push`. Alternative
considered: a module-level collector, which would have been a smaller diff but introduces global
mutable state into a published library — rejected.

**Identical content is a success, not a conflict.** Re-running a conversion into its own output is
the common case (a user re-syncing after editing the source). Treating that as a conflict would make
the tool unusable idempotently. The file is not rewritten, and the path is still reported as written
because the target state is achieved.

**A conflict blocks only its own file.** Other files still write. This matches the per-item blocking
decided in `fidelity-core` and for the same reason: an all-or-nothing refusal makes the common case
unreachable. The run still exits 2.

**`--force` reports `lossy`, not `exact`.** Overwriting destroys the previous content; the `.bak`
makes it recoverable, not un-lost. Naming the backup path in the item is what makes recovery
actionable.

**Agent bodies are NOT merged into Windsurf or Codex rules.** The Phase 2 plan proposed appending
them so the old "merged into rules" warning would become true. On reading the semantics this is the
wrong fix: an agent body is instructions for a specific delegated task, while
`.windsurf/rules/*.md` and `AGENTS.md` are always-on context. Merging five agents' prompts into one
always-on file produces contradictory global instructions — worse than dropping, and it would be
done silently. `fidelity-core` already made the report honest by marking them `dropped`. If content
preservation is wanted later, the right target is `.windsurf/rules/<agent>.md` with
`trigger: model_decision` and the agent's description, which preserves the "invoke when relevant"
semantics. Deferred rather than guessed at.

**zod is removed.** It has been types-only since the beginning — no `.parse` or `.safeParse`
anywhere. The one place runtime validation could earn its keep is `readJsonIfExists`, and the
requirement there is only to distinguish "absent" from "malformed", which `JSON.parse` throwing
already tells us exactly. Adding schema validation on top would reject configs that are structurally
fine but shaped unexpectedly — worse for a migration tool whose job is to be liberal in what it
accepts. `schema.ts` becomes plain TypeScript types and the runtime dependency goes.

## Risks / Trade-offs

Per converter, whether emitted output changes:

- **All six** — *no change to emitted content, paths, or layout.* The change gates whether a write
  occurs. [Risk: a mechanical error while touching 22 call sites silently stops a file being
  written] → Mitigation: the existing suite asserts on `filesWritten` per converter, and the
  end-to-end test reads emitted files back from disk. A dropped write fails those.
- **opencode** — *formatter keys change* where a config used `black`, `isort`, `autopep8`, or
  `yapf`, which previously all emitted the key `ruff`. [Risk: a user's `opencode.json` formatter key
  changes name on re-conversion] → Mitigation: the old behaviour was a defect that silently
  discarded one of two formatters; the new key matches the command actually being run. Called out in
  the changelog.
- **copilot** — *rule filenames change* only for rules with no source name, which previously all
  collided onto `rule.instructions.md`. Rules with a source name are unaffected.

[Risk: users who ran a conversion into a live repo now get exit 2 where they got 0] → Mitigation:
this is the intended correction — those runs were destroying files. `--force` restores the previous
behaviour with a backup. Changelog leads with it.

[Risk: removing zod is a breaking type change for library consumers] → Mitigation: the inferred
types are structurally identical, so `HarnessConfig` and friends keep the same shape. Only a
consumer importing `HarnessConfigSchema` itself breaks, and that is not a documented surface.

## Migration Plan

**Deployment order.** `WriteContext` and `writeIfNotDry` in `src/utils.ts` first, then
`Converter.export`'s options object in `src/converters/types.ts`, then the six converters one at a
time, then `src/index.ts`. Interfaces before callers.

**Backward compatibility.** No input becomes invalid and no output shape changes. A user converting
into a clean directory sees byte-identical results to `fidelity-core`.

**Rollback.** Pin `harnessport@0.1.2`. Files written by this version are readable by it; `.bak`
files are inert. No on-disk migration in either direction.

**Re-run guidance.** Users who converted into a non-empty directory under 0.1.x may have lost
hand-written config. There is no way to detect this after the fact — the changelog says so plainly
rather than implying the tool can recover it.

## Open Questions

- Whether `--force` should also be gated behind a confirmation prompt for interactive terminals.
  Deferred: the CLI is used in scripts and CI as much as interactively, and a prompt that only
  sometimes appears is worse than a flag that always means the same thing.

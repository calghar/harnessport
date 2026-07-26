## Context

`tests/matrix.test.ts` performs a round trip over all 30 pairs and asserts that everything lost is
named by a fidelity item. That assertion is the project's whole positioning stated as an
executable property, and building it found three defects on first run. It exists only inside a
test file, where users cannot reach it and where it only ever runs against six fixtures.

Constraints:

- **`verify` must not write into the directory it inspects.** It is an instrument, and an
  instrument that alters what it measures is worse than none. The temporary directory is created
  with `fs.mkdtempSync`, never derived from the argument.
- **One comparison, not two.** If the command and the test compared differently, one of them would
  be lying. `src/compare.ts` is extracted from the test and the test then consumes it.
- `permissionStatus` and `writeIfNotDry` are untouched. Neither command adds a decision site for
  permissions or writes.
- Exit codes keep their existing meanings: `0` fine, `1` cannot run, `2` look at this.

## Goals / Non-Goals

**Goals:**

- Give users the round-trip check the test suite has, against their own repository.
- Make "the fidelity report accounts for every loss" a claim a user can falsify.
- Give a repository with several harness configs a CI gate for drift between them.

**Non-Goals:**

- Repairing drift. `check` reports; it does not write. Fixing divergence is `convert`'s job, and
  doing it implicitly from a command named `check` would be a trap.
- Comparing item *contents*. Both commands compare the set of named things. An agent whose body
  changed but whose name did not is not reported — a content diff needs a normalisation story per
  field per harness, which is a larger design than this earns today.
- Round-tripping in both directions. `verify --from X --to Y` measures X→Y. The reverse is a
  separate invocation, which keeps the report readable and the failure attributable.

## Decisions

**1. `verify` exits 2 on unaccounted loss only, never on loss itself.**

Converting Claude permissions to Cursor loses all of them, and that is correct behaviour, fully
reported. Exiting non-zero for it would make the command useless — every real conversion loses
something. The distinction that matters is whether the report *said so*. So `accounted` is
informational and `unaccounted` is the failure, which makes `verify` a direct test of the
fidelity report's honesty rather than a measure of conversion quality.

Rejected: a `--strict` flag that fails on any loss. It re-frames the command around a number that
is already in `convert`'s output, and invites the habit of ignoring exit 2.

**2. Compare named things, keyed exactly as fidelity items name them.**

`Tool(pattern)` for permissions, the glob for formatters, `name` for everything else. This
alignment is load-bearing: the first draft of the probe that became this comparison reported 26
losses, 22 of which were the probe's own key mismatch. Getting it wrong produces confident
nonsense, so the key construction lives in one function next to the diff that consumes it.

Permission tool names compare case-insensitively. OpenCode's config keys are legitimately
lowercase, and calling that a loss would bury the real signal. Whether a lowercase name *matches*
in the target is a separate question, already fixed at the source in `conversion-matrix`.

**3. Rules compare by content containment, not by set equality.**

Several exporters concatenate every rule into one file — `AGENTS.md`, `CLAUDE.md` — so after a
round trip the target holds one rule containing all of the source's text. Set equality would
report every rule as lost on those paths. Containment of each source rule's text in the target's
joined rule text is the property that actually holds and the one users care about.

**4. `check` compares pairwise and reports direction.**

"Present in claude, absent from opencode" is actionable; "these differ" is not. With six possible
harnesses the pair count is small enough that the full pairwise report stays readable, and a
repository with more than two or three configured harnesses is rare.

**5. The temporary directory is not cleaned up.**

The test suite already leaves its `mkdtemp` directories behind, and a failed verification is much
easier to diagnose when the emitted tree still exists. The path is printed. The OS reclaims the
temporary directory; a cleanup path that ran on failure would delete exactly the evidence someone
needs.

## Risks / Trade-offs

**Per converter — does emitted output change?** No converter is modified, and neither command
calls any exporter against a user-supplied path. `verify` calls `export` only against a
`mkdtemp` directory; `check` calls no exporter at all.

| Converter | Modified? | Emitted output changes? |
|---|---|---|
| claude, opencode, cursor, windsurf, copilot, codex | No | No |

- [`verify` writes into the user's repository through a path bug] → The export target is the
  return value of `fs.mkdtempSync`, never `dir` or anything derived from it. A scenario asserts
  the inspected directory's file set and contents are unchanged, comparing a recursive hash before
  and after.
- [Extracting `inventory` out of `tests/matrix.test.ts` changes what that test asserts] → The
  function moves unmodified and the test imports it. The 30 pair assertions stay green, which is
  the regression check.
- [`check` reports noise on a repository where several harnesses read the same `AGENTS.md`] →
  Cursor, Windsurf, Copilot, OpenCode, and Codex all import a root `AGENTS.md`, so they agree on
  it rather than diverging. Rule comparison by content makes that agreement visible instead of
  turning file-name differences into false divergence.
- [Exit `2` from `check` in CI on a repository that legitimately keeps different configs per
  harness] → That repository should not run `check`; it is opt-in, and the README says what it
  asserts. No default behaviour changes.

## Migration Plan

Nothing to migrate. Two additive read-only commands; no format, flag, or exit code changes to
anything that exists.

- **Files written by an earlier version:** unaffected. Neither command writes.
- **Rollback:** pin `harnessport@0.1.2`; the commands simply do not exist there. No emitted file
  differs between versions as a result of this change.

## Open Questions

None. One deliberate limit is recorded rather than left open: neither command compares item
*contents*, only the set of named items. An agent whose body was mangled but whose name survived
passes both. Closing that needs per-field normalisation across six harnesses and belongs in its
own change.

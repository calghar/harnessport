## Context

`Rule` already carries `globs`, and five of six converters round-trip it correctly. `claude.ts` is
the only one that drops it: `importRules` (`:43-48`) reads a single file and sets no globs, and the
exporter calls `exportRulesToFile` (`:373`), which concatenates every rule into one always-on file.
`fidelity-core` added a placeholder `lossy` item at `:404-415` acknowledging this; that placeholder
is what this change removes by actually preserving the scoping.

Claude Code's documented behaviour, confirmed against the current docs:

- Project instructions live at `./CLAUDE.md` **or** `./.claude/CLAUDE.md`; both load.
- `./CLAUDE.local.md` loads alongside them.
- `.claude/rules/*.md` are discovered recursively. A rule with `paths:` frontmatter loads only when
  Claude touches a matching file; a rule without `paths` loads unconditionally.

That `paths:` field is the semantic twin of Cursor's `globs:` and Copilot's `applyTo:`.

Constraints:

- The other five converters are correct and out of scope.
- `exportRulesToFile` keeps its behaviour for opencode and codex, which target `AGENTS.md` and have
  no scoping concept.
- New writes route through `writeIfNotDry`, inheriting the `safe-writes` conflict rules.

## Goals / Non-Goals

**Goals**

- Detect and import every documented Claude instruction location.
- Preserve file-scoped rules across Cursor ↔ Claude and Copilot ↔ Claude.
- Report precisely what scoping could not be preserved.

**Non-Goals**

- `@path` imports inside CLAUDE.md. Claude Code expands them at load time; following them would
  inline content the user deliberately kept in a separate file, and re-emitting it would duplicate.
  Treated as opaque text.
- Managed-policy and user-scope locations (`~/.claude/CLAUDE.md`, `/Library/...`). Project-level
  only, consistent with the rest of the tool.
- Nested per-directory `CLAUDE.md` files in subdirectories. The tool converts one project root.
- The capability matrix (Phase 4).

## Decisions

**Unscoped rules go to the instruction file that already exists, defaulting to `.claude/CLAUDE.md`.**
Both locations load, so unconditionally writing `.claude/CLAUDE.md` into a repo that already has a
root `CLAUDE.md` would give Claude Code two rule files and duplicate the content in context.
Preferring the existing file avoids that. Defaulting to `.claude/CLAUDE.md` when neither exists
keeps output byte-identical for a clean target, so this is not a breaking change. Alternative
considered: always write root `./CLAUDE.md` as the more common convention — rejected because it
changes the output location for every existing user and strands their `.claude/CLAUDE.md`.

**A rule is "scoped" if it has a glob.** Globs are what `paths:` expresses. `alwaysApply` maps to
its absence, which is exactly how Claude Code treats a rule with no `paths`. No extra state needed.

**A description without a glob is `lossy`, not `dropped`.** The rule's content is still written to
the instructions file — only its conditional activation is lost, so it becomes always-on. That is
written-with-detail-dropped, which is the definition of `lossy`. Reporting it `dropped` would imply
the content vanished.

**`getGlobs` is reused for `paths:`.** It already accepts a string or a list and normalises to a
comma-joined string, which is exactly the shape `Rule.globs` uses and what Cursor and Windsurf
already feed it. No new parsing.

**Rule filenames route through `uniqueSlugs`.** Two rules whose sources slugify identically would
otherwise collide in `.claude/rules/`, which is the bug `safe-writes` fixed elsewhere; the new
write path must not reintroduce it.

## Risks / Trade-offs

Per converter, whether emitted output changes:

- **claude** — *output changes only for configs holding glob-scoped rules.* Those rules move from
  the concatenated instructions file into `.claude/rules/*.md`. [Risk: a user converting
  cursor→claude sees rules move location between versions] → Mitigation: this is the fix, and it is
  what makes the round trip lossless; called out in the changelog. A config with no glob-scoped
  rules — including the `sample-project` fixture — emits byte-identical output, asserted by test.
- **The other five** — *no change.* They neither read nor write Claude paths.

[Risk: widening `detect` makes claude match repositories that previously matched nothing, changing
`harnessport detect` output] → Mitigation: this is a correctness fix — the repo demonstrated the gap
on itself, where `.claude/skills/` and `.claude/commands/` existed and detection reported nothing.
Broader detection cannot cause data loss; it only makes conversion available.

[Risk: reading four instruction locations multiplies rules where a repo has several] → Mitigation:
that is faithful — Claude Code loads all of them, so importing all of them is the accurate reading.
Each rule keeps its `source`, so the exporter can name files distinctly.

[Risk: a rule imported from `.claude/rules/` and re-exported produces a differently named file] →
Mitigation: `source` carries the original filename and the exporter derives the name from it, so a
claude→claude round trip is stable. Asserted by test.

## Migration Plan

**Deployment order.** `importRules` and `detect` first, then the export split, then the item
reporting. Read side before write side, so a partially applied change never writes scoping it
cannot read back.

**Backward compatibility.** No input becomes invalid; the change only widens what is read. Output
is byte-identical for configs without glob-scoped rules.

**Rollback.** Pin `harnessport@0.1.2`. Files written under `.claude/rules/` are ordinary markdown
that Claude Code reads natively; rolling back the tool leaves them working, though 0.1.x would not
import them.

**Re-run guidance.** Users who converted cursor→claude or copilot→claude under an earlier version
lost their rule scoping — the rules became always-on. Re-running recovers it, provided the source
config still exists.

## Open Questions

- Whether a rule with both a glob and a description should also emit the description somewhere.
  Claude Code's `paths:` frontmatter has no description field. Currently the glob is preserved and
  the description is silently unused rather than reported, because the rule is not lossy in any way
  that affects activation. Revisit if a user asks.

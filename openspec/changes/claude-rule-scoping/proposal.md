## Why

The Claude importer reads only `.claude/CLAUDE.md`, so the documented and more common project
layout — `./CLAUDE.md` at the repository root — is invisible: `detect` returns false and `convert`
exits 1 on a repo full of convertible configuration. Separately, Claude Code supports
`.claude/rules/*.md` with `paths:` frontmatter, which is a direct equivalent of Cursor's `globs:`
and Copilot's `applyTo:`, but every rule is currently flattened into one always-on `CLAUDE.md`,
discarding the scoping.

## What Changes

- **MODIFIED** `importRules` (`src/converters/claude.ts`) reads `./CLAUDE.md`,
  `./.claude/CLAUDE.md`, `./CLAUDE.local.md`, and `.claude/rules/**/*.md`, instead of only
  `.claude/CLAUDE.md`.
- **ADDED** `.claude/rules/*.md` `paths:` frontmatter maps to and from `Rule.globs`, so file-scoped
  rules survive a trip through Claude rather than becoming always-on.
- **MODIFIED** The Claude exporter writes rules that carry a glob to
  `.claude/rules/<name>.md` with `paths:`, and only unscoped rules to the single instructions file.
- **MODIFIED** `detect` (`src/converters/claude.ts`) recognises `./CLAUDE.md`, `./CLAUDE.local.md`,
  `.claude/rules/`, `.claude/skills/`, `.claude/agents/`, and `.claude/commands/` in addition to
  what it already checks.
- **MODIFIED** The instructions file is written to `./CLAUDE.md` when one already exists there, and
  to `.claude/CLAUDE.md` otherwise, so a repo using the root convention does not end up with two
  rule files that Claude Code would both load.

## Capabilities

### Modified Capabilities

- `conversion-reporting`: a rule whose scoping cannot be preserved is reported precisely rather
  than as a blanket "merged into CLAUDE.md".

### New Capabilities

- `claude-rule-scoping`: which files the Claude converter reads and writes, and how file-scoped
  rules map to and from `paths:` frontmatter.

## Blast radius

GATE 1 measured by grep, confirmed by reading each site.

**The blast radius is one converter.** `Rule.globs` already round-trips correctly through the
other five: cursor imports at `:52` and exports at `:117`; windsurf imports at `:46` and exports at
`:95`; copilot imports `applyTo` at `:63` and exports it at `:183`. opencode and codex write
`AGENTS.md`, which has no scoping concept, and are unaffected. `claude.ts` is the only converter
that reads a glob into the canonical schema and then drops it on the way out.

- `src/converters/claude.ts` — `importRules` (`:43-48`), `detect` (`:328-334`), the
  `exportRulesToFile` call (`:373-377`), and the placeholder lossy item (`:404-415`) added in
  `fidelity-core` that this change replaces.
- `src/utils.ts` — `getGlobs` (`:111`) is reused as-is for parsing `paths:`; `exportRulesToFile`
  keeps its current behaviour for the opencode and codex `AGENTS.md` path.

Do-not-touch boundaries:

- The other five converters. Their rule handling is already correct.
- `exportRulesToFile`'s behaviour for `AGENTS.md` targets.
- The `safe-writes` conflict rules — new files route through the same `writeIfNotDry`.

## Impact

**On-disk format.** For Claude targets, rules carrying a glob now land in `.claude/rules/*.md`
rather than being concatenated into the instructions file. A config whose rules have no globs — the
`sample-project` fixture, and any claude→claude-shaped source — emits byte-identical output.

**Recovering previously lost data.** Converting `cursor → claude → cursor` previously returned
always-on rules with their globs erased. It now round-trips the scoping.

**Detection.** Repositories that `detect` previously missed — a root `CLAUDE.md`, or a `.claude/`
holding only skills, agents, or commands — are now recognised. This turns some exit-1 runs into
successful conversions.

**Security posture.** Not affected. This change touches rules only; permissions are untouched.

**CLI surface.** No new flags. No exit code changes.

**API.** No type changes. `Rule` already carries `globs`.

**Dependencies.** None added or removed.

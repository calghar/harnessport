## 1. BDD barrier (land first)

- [x] 1.1 Generate and run the BDD barrier before any code task:
      `uv run --no-project --script ~/.claude/tools/openspec-bdd.py generate --change claude-rule-scoping`,
      commit the generated `.feature` files, run vitest, and record the result. Every new ADDED
      scenario must be red; the 87 existing tests must stay green.

## 2. Read side (before the write side)

- [x] 2.1 `src/converters/claude.ts`: `importRules` reads `./CLAUDE.md`, `./.claude/CLAUDE.md`, and
      `./CLAUDE.local.md`, each as its own rule carrying its filename as `source`.
- [x] 2.2 `src/converters/claude.ts`: `importRules` reads `.claude/rules/**/*.md` recursively,
      mapping `paths:` frontmatter to `Rule.globs` via the existing `getGlobs`.
- [x] 2.3 `src/converters/claude.ts`: widen `detect` to `./CLAUDE.md`, `./CLAUDE.local.md`,
      `.claude/rules/`, `.claude/skills/`, `.claude/agents/`, and `.claude/commands/`.
- [x] 2.4 Regression test: the `sample-project` fixture still imports exactly one rule, so existing
      count assertions hold.

## 3. Write side

- [x] 3.1 `src/converters/claude.ts`: split rules into scoped (has a glob) and unscoped. Write
      scoped rules to `.claude/rules/<name>.md` with a `paths:` list, naming files via
      `uniqueSlugs` so two sources cannot collide.
- [x] 3.2 `src/converters/claude.ts`: write unscoped rules to `./CLAUDE.md` when that file already
      exists in the target, otherwise `.claude/CLAUDE.md`. Never both.
- [x] 3.3 `src/converters/claude.ts`: replace the `fidelity-core` placeholder item at `:404-415`.
      A scoped rule is `exact`; a rule with a description and no glob is `lossy` naming the
      description; a plain rule is `exact`.
- [x] 3.4 Regression test: a config whose rules carry no globs emits byte-identical output to
      `safe-writes`, so existing users see no change.

## 4. Verification

- [x] 4.1 Round-trip test: a cursor rule with `globs: src/**/*.ts` converted to claude and back to
      cursor still carries `globs: src/**/*.ts`.
- [x] 4.2 Round-trip test: a claude `.claude/rules/api.md` with `paths:` converted to copilot
      emits `applyTo`, and back again.
- [x] 4.3 End-to-end: a repository whose only Claude config is a root `CLAUDE.md` is detected and
      converts successfully, where it previously exited 1.
- [x] 4.4 Run `npm run check`. Diff emitted output against the `safe-writes` build for a
      glob-free config across all six targets; assert byte-identical.
- [x] 4.5 Update `CHANGELOG.md` under `[Unreleased]` and `README.md`'s file-location table.

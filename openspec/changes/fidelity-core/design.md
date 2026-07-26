## Context

harnessport imports a source harness's config into `HarnessConfig` (`src/schema.ts`) and exports it
to a target's layout. Six converters implement `Converter` (`src/converters/types.ts`). The package
is published (`harnessport@0.1.2`) and its product is files written into a user's repository.

Two defects drive this change. `PermissionEntry` is `{ tool, pattern }` with no action, so
`opencode.ts` `parsePermissions` discards the `"allow" | "ask" | "deny"` value via `Object.keys`, and
`claude.ts` `buildSettingsLocalJson` writes every surviving entry into `permissions.allow` — a deny
becomes an allow. Separately, loss is reported as free-text `warnings: string[]`, which cannot tell a
caller what converted exactly versus what did not convert at all.

Constraints this change lives under:

- **Emitted paths and directory layout are frozen.** This change alters what is refused and what is
  reported, not where files land.
- **`serializeFrontmatter` is frozen.** Settled in Phase 0 when `gray-matter` was replaced.
- **`tests/fixtures/sample-project/` is frozen.** Every existing test asserts against its counts;
  new fixtures go alongside it.
- **Four of six targets have no permission model.** cursor, windsurf, copilot, and codex have zero
  references to `config.permissions` in their export paths. Any design that makes an unrepresentable
  permission fail the whole run makes those four targets unreachable.

## Goals / Non-Goals

**Goals**

- A `deny` or `ask` is never emitted as an `allow`, on any target.
- Claude permissions are read from both settings files and all three action keys.
- One representation of conversion fidelity, covering both import and export.
- An exit code that distinguishes refusal from ordinary loss, and a `--json` surface.

**Non-Goals**

- Rule scoping and `.claude/rules/` (Phase 3).
- Safe writes, backups, and collision handling (Phase 2).
- The capability matrix as data (Phase 4).
- New target harnesses.
- Resolving zod's fate. It stays types-only here; Phase 2 either uses it for finding M3 or drops it.

## Decisions

**Blocking is per item, not per run.** A blocked permission suppresses only that permission; every
other feature still converts and its files are still written. Alternative considered: abort the
whole conversion. Rejected because cursor, windsurf, copilot, and codex can never represent a deny,
so aborting would make those four targets permanently unreachable for any user holding one deny rule.

**Exit 2 on blocked only, never on lossy.** Measured on the existing fixture: converting to cursor
already emits 2 warnings and to windsurf 4. Lossy is the normal case for this tool, so an exit code
that fired on it would be noise. Blocked is exceptional and therefore carries signal.

**No downgrade flag.** There is no option that emits a deny as an allow. The blocked item names the
permission so a user can carry it across by hand. A documented downgrade path would undermine the one
guarantee this change exists to make.

**`FidelityItem[]` replaces `warnings: string[]` outright**, on both `ExportResult` and
`HarnessConfig`. Alternative considered: keep both. Rejected — two hand-maintained representations of
one fact is exactly how the README table and the CLI `list` matrix drifted apart (audit finding H5).
Human stdout and `--json` both render from items, so they cannot disagree.

**`generateDropWarnings` becomes `generateDropItems`** returning `FidelityItem[]`. It already has the
per-feature shape; this is a return-type change, not a rewrite. Renaming rather than overloading
keeps the four call sites honest about what they now produce.

**Per-target permission capability is declared, not inferred.** Each converter states which actions
it can represent, so the blocked decision is a lookup rather than logic duplicated six times. This is
the seed of the Phase 4 capability matrix, but scoped here to permissions only — a full capability
declaration is Phase 4's job and is not built speculatively.

## Risks / Trade-offs

Per converter, whether emitted output changes:

- **claude** — *output changes.* `.claude/settings.local.json` gains `deny` and `ask` keys.
  Permissions read from `.claude/settings.json` are written back there rather than collapsed into
  the local file. [Risk: a user's existing local file is rewritten with a different shape] →
  Mitigation: the change only widens which keys are written; an `allow`-only config still emits an
  `allow`-only file, so users without deny rules see byte-identical output. Covered by a
  preserved-behaviour scenario.
- **opencode** — *output changes only for deny/ask.* Granular tools keep per-pattern actions;
  shorthand-only tools holding a deny become blocked instead of collapsing to `allow`.
  [Risk: `buildPermissionConfig` currently hardcodes `action: "allow"` at `opencode.ts:394`, so every
  entry silently widens] → Mitigation: that literal is the defect; it is replaced by the entry's own
  action, and a scenario asserts a shorthand deny is refused rather than widened.
- **cursor, windsurf, copilot, codex** — *no change to emitted files.* None reference
  `config.permissions` in export. They gain blocked items and a possible exit 2, but write exactly
  what they wrote before. [Risk: a user converting to these targets now sees exit 2 where they saw 0]
  → Mitigation: this is the intended signal, and files are still written; documented in the changelog
  as breaking.

[Risk: `HarnessConfig.warnings` → `items` touches all six importers] → Mitigation: five of six set it
to `[]` today; only `codex.ts:94` populates it. Land the schema change first, then converters one at
a time, per the task order.

[Risk: library consumers importing `ExportResult` or `HarnessConfig` see a breaking type change] →
Mitigation: the package ships a `bin` and no `exports` map, so CLI use is the documented path. Called
out as BREAKING with a minor bump to 0.2.0, which is permitted pre-1.0.

[Risk: the four existing export tests assert on `result.warnings`] → Mitigation: they are updated to
assert on items in the same task that changes the type, so the suite never sits red between steps.

## Migration Plan

**Deployment order.** `src/schema.ts` and `src/converters/types.ts` first, then `src/utils.ts`
helpers, then each converter, then `src/index.ts`. Interfaces before callers; one reviewable unit
each.

**Backward compatibility of input.** This change only widens what is read — `permissions.deny`,
`permissions.ask`, and `.claude/settings.json` were previously ignored. No config that parsed before
fails to parse now, so users need take no action on their inputs.

**Backward compatibility of output.** Files written by 0.1.x remain readable by 0.2.0. Files written
by 0.2.0 are readable by 0.1.x with one caveat: 0.1.x ignores `permissions.deny` and
`permissions.ask` entirely, so a config written by 0.2.0 and then re-imported by 0.1.x loses its deny
rules. This is the pre-existing defect, not a regression introduced here.

**Rollback.** Pin `harnessport@0.1.2`. Emitted files remain readable by that version, subject to the
caveat above. No on-disk migration is required in either direction, because no file path or file
format is removed — only keys are added.

**No re-run required.** Users are not required to re-convert. Users who hold deny rules and converted
under 0.1.x should re-run, because their previous conversion wrote those rules into an allow list;
the changelog states this.

## Open Questions

- Whether `ask` should block or degrade on OpenCode's shorthand-only tools. Current spec treats it
  the same as `deny` — refuse rather than widen. If that proves too strict in practice, the narrower
  rule would be to block only `deny` and report `ask` as lossy. Deferred until there is a real
  config that hits it.
- Whether `--json` should suppress the human summary entirely or print it to stderr. Spec requires
  only that stdout parses as JSON; the implementation will send human output to stderr under
  `--json`, which satisfies it and keeps both available.

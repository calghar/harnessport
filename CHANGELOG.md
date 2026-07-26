# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- Converting no longer overwrites existing files. A target file that exists with different
  content is refused and reported, and the run exits `2`. **Conversions run with 0.1.x into a
  directory that already held configuration silently destroyed those files; there is no way to
  recover them after the fact.** Use `--force` to overwrite deliberately, which saves the
  previous content to `<path>.bak` first.
- A permission `deny` or `ask` rule is no longer converted into an `allow` rule. Permission
  entries now carry their action, and a target that cannot express the action refuses the entry
  rather than emitting a weakened form. **Anyone who converted a config containing deny rules
  with 0.1.x should re-run the conversion and inspect the result** — those rules were previously
  written into the target's allow list.
- Claude permissions are read from both `.claude/settings.json` and
  `.claude/settings.local.json`, and from the `allow`, `ask`, and `deny` keys. Previously only
  the local file's `allow` list was read, so every deny rule was silently discarded on export.
- Permission tool names now convert in a form the target matches. OpenCode's config keys are
  lowercase, and importing them verbatim wrote `bash(git push *)` into
  `.claude/settings.local.json`, where Claude Code matches `Bash` — **so an `ask` or `deny` rule
  converted from OpenCode never fired, and the command ran unprompted.** Anyone who converted
  OpenCode permissions into Claude Code should re-run the conversion; the existing file is refused
  as a conflict, so use `--force`, which keeps a `.bak`.
- A `WebSearch` permission bound for OpenCode is reported `dropped` — or `blocked` for `ask` and
  `deny` — instead of `exact`. OpenCode has no `websearch` permission key, so the entry was
  filtered out of the emitted config while the run reported it fully converted. A `WebSearch` deny
  now exits `2` where it previously exited `0`.

### Added

- `harnessport verify <dir> --from X --to Y` round-trips a directory through a tool pair and
  reports what did not survive, separating loss the conversion accounted for from loss it did not.
  Exits `2` only on unaccounted loss — losing something the report admitted losing is ordinary.
  It converts into a temporary directory and never writes into the directory it inspects.
- `harnessport check <dir>` imports every harness configured in a directory and reports where they
  disagree, naming which harness has each item and which does not. Exits `2` on divergence, `0`
  when they agree or when only one harness is present. Read-only, for pre-commit and CI.
- `--json` on both new commands, matching `convert`: machine-readable on stdout, human-readable on
  stderr.
- Each converter declares a `capabilities` record — one of `full`, `user-level`, or `none` per
  feature — and `harnessport list` and the README support matrix both render from it. The three
  descriptions could previously disagree, and did.
- `npm run docs:matrix` regenerates the README matrix; `npm run docs:check` fails on drift and runs
  as part of `npm run check`.
- File-scoped rules survive conversion. Claude Code's `.claude/rules/*.md` with `paths:`
  frontmatter is now mapped to and from Cursor's `globs:` and Copilot's `applyTo:`, so
  `cursor → claude → cursor` returns the original scoping. Previously every scoped rule was
  merged into one always-on `CLAUDE.md` with its globs discarded — re-run those conversions to
  recover the scoping.
- The Claude importer reads `./CLAUDE.md`, `./.claude/CLAUDE.md`, `./CLAUDE.local.md`, and
  `.claude/rules/**/*.md`. It previously read only `.claude/CLAUDE.md`, so a repository using the
  root `CLAUDE.md` convention reported "no claude configuration found" and exited 1.
- Detection recognises a repository whose only Claude configuration is `.claude/skills/`,
  `.claude/agents/`, `.claude/commands/`, or `.claude/rules/`.
- `convert --force` overwrites conflicting files, keeping a `.bak` copy of each.
- Per-item fidelity reporting. Every rule, agent, skill, command, MCP server, permission, hook,
  and formatter is classified `exact`, `lossy`, `dropped`, or `blocked`, with a reason.
- `convert --json` writes the fidelity report to stdout as JSON; human-readable output moves to
  stderr so stdout stays parseable.
- `convert` exits `2` when any item is `blocked`. It exits `0` for `lossy` and `dropped` items,
  which are ordinary. Existing exit `1` conditions are unchanged.

### Fixed

- `harnessport list` reported Cursor agents, skills, and commands, and Copilot agents, skills,
  commands, MCP servers, and hooks, as unavailable. All eight are implemented and now read `✓`.
- The support matrix marked a feature `partial` where harnessport converts nothing at all. Windsurf
  MCP servers and Codex agents now read `user-level`, naming the reason — they live outside the
  repository, in a file that is not read. Codex permissions now read `-`: its `approval_policy` and
  `sandbox_mode` are a sandbox mode, not a tool-and-pattern permission list, so nothing maps onto
  them.
- A hook exported to OpenCode is reported `dropped` rather than `lossy`. Nothing was ever written
  for it, and `lossy` claimed the content had reached the target with a detail removed.
- A formatter exported to Claude Code is reported `lossy` when its glob cannot survive. Claude Code
  runs a formatter as a `PostToolUse` hook, whose matcher selects tool names rather than file
  paths, so the glob is re-derived from the command on the way back — `*.ts` with an unrecognised
  command became `*`, which runs the formatter over every file in the repository. The emitted hook
  is unchanged; only the reported status and its reason are.
- All 30 ordered conversion paths are now tested against real files, with a source fixture per
  harness. Five of the six importers were previously never invoked by any test, and every export
  test ran with `dryRun`, so the serialization path never executed. The block named
  `round-trip: claude -> opencode -> claude` performed no export and no re-import.
- Test files are type-checked. `tsconfig.json` excluded `tests`, which hid a call passing the
  pre-0.2.0 boolean third argument to `Converter.export`.
- Two inputs whose names differ only by case or separator (`Testing` and `testing`,
  `code review` and `code-review`) no longer collapse onto one output file, silently discarding
  the first. The same applied to Copilot rules with no source filename, which all collided onto
  `rule.instructions.md`.
- Formatter names derive from the command actually being run. `black`, `isort`, `autopep8`, and
  `yapf` previously all emitted the key `ruff`, so a project using two of them lost one, and the
  surviving entry named a tool its command did not invoke.
- A malformed or unreadable config file is reported as `blocked` rather than being
  indistinguishable from an absent one. A syntax error in `.mcp.json` previously printed
  `MCP Servers: 0` and exited `0`.
- The Windsurf and Codex exporters reported that agent instructions had been "merged into rules"
  and "merged into AGENTS.md". Neither wrote agent content anywhere. They now report agents as
  `dropped`, naming each one.
- `--version` reports the packaged version instead of a hardcoded `0.1.0`.
- The Claude exporter reported no loss at all. It now reports rule scoping dropped when rules are
  merged into a single `CLAUDE.md`, and per-agent fields Claude Code cannot express.

### Changed

- **Breaking:** `ExportResult.warnings` and `HarnessConfig.warnings` are replaced by
  `items: FidelityItem[]`. Scripts parsing the `⚠` lines should use `--json`.
- **Breaking:** `PermissionEntry` carries a required `action` field.
- **Breaking:** `Converter.export` takes `options?: { dryRun?, force? }` in place of
  `dryRun?: boolean`.
- **Breaking:** `Converter` carries required `capabilities` and `label` fields.
- `harnessport list` output changes shape slightly — columns are sized to their contents, and the
  legend names three states rather than lumping "partial" and "user-level" together. It remains
  human-readable output; `convert --json` is the surface for scripts.

### Removed

- `zod` dependency. The schema was only ever used to infer types, never to validate at runtime;
  it is now plain TypeScript. Runtime dependencies are `commander` and `yaml`.

### Security

- A permission `deny` or `ask` rule is no longer converted into an `allow` rule. Permission
  entries now carry their action, and a target that cannot express the action refuses the entry
  rather than emitting a weakened form. **Anyone who converted a config containing deny rules
  with 0.1.x should re-run the conversion and inspect the result** — those rules were previously
  written into the target's allow list.
- Claude permissions are read from both `.claude/settings.json` and
  `.claude/settings.local.json`, and from the `allow`, `ask`, and `deny` keys. Previously only
  the local file's `allow` list was read, so every deny rule was silently discarded on export.

### Added

- Per-item fidelity reporting. Every rule, agent, skill, command, MCP server, permission, hook,
  and formatter is classified `exact`, `lossy`, `dropped`, or `blocked`, with a reason.
- `convert --json` writes the fidelity report to stdout as JSON; human-readable output moves to
  stderr so stdout stays parseable.
- `convert` exits `2` when any item is `blocked`. It exits `0` for `lossy` and `dropped` items,
  which are ordinary. Existing exit `1` conditions are unchanged.

### Fixed

- The Windsurf and Codex exporters reported that agent instructions had been "merged into rules"
  and "merged into AGENTS.md". Neither wrote agent content anywhere. They now report agents as
  `dropped`, naming each one.
- `--version` reports the packaged version instead of a hardcoded `0.1.0`.
- The Claude exporter reported no loss at all. It now reports rule scoping dropped when rules are
  merged into a single `CLAUDE.md`, and per-agent fields Claude Code cannot express.

### Changed

- **Breaking:** `ExportResult.warnings` and `HarnessConfig.warnings` are replaced by
  `items: FidelityItem[]`. Scripts parsing the `⚠` lines should use `--json`.
- **Breaking:** `PermissionEntry` carries a required `action` field, defaulting to `allow`.

### Security

- Frontmatter parsing no longer depends on `js-yaml` 3.x, which is affected by a
  quadratic-complexity denial of service via YAML merge keys
  ([GHSA-h67p-54hq-rp68](https://github.com/advisories/GHSA-h67p-54hq-rp68),
  [GHSA-52cp-r559-cp3m](https://github.com/advisories/GHSA-52cp-r559-cp3m)). The parser reads
  frontmatter from files in the repository being converted, so this was reachable from untrusted
  input. Runtime dependency audit is now clean.

### Changed

- Frontmatter parsing and serialization use `yaml` instead of `gray-matter`. Emitted YAML is
  quoted only where the specification requires it, rather than more eagerly; all values parse
  back unchanged.

### Removed

- `gray-matter` dependency.

### Added

- `tests/frontmatter.test.ts` covering frontmatter parsing and serialization, including BOM,
  CRLF, empty blocks, horizontal rules in the body, and round-tripping of values that need
  quoting.
- CI workflow running `npm run check` and `npm run build` on push and pull request across
  Node 18, 20, and 22.
- This changelog.

## [0.1.2] - 2026-04-29

### Added

- Initial release. Converts rules, agents, skills, commands, MCP servers, permissions, hooks, and
  formatters between Claude Code, OpenCode, Cursor, Windsurf, GitHub Copilot, and Codex CLI.
- `convert`, `detect`, and `list` commands, with `--dry-run` on `convert`.

[Unreleased]: https://github.com/calghar/harnessport/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/calghar/harnessport/releases/tag/v0.1.2

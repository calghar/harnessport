# harnessport

Convert AI coding harness configurations between tools. Supports rules, agents, skills, commands, MCP servers, permissions, hooks, and formatters.

## Supported Tools

This table is generated from each converter's own declaration, and a test asserts every cell
against what that converter actually reports converting. Run `npm run docs:matrix` to regenerate.

<!-- BEGIN:matrix -->

| Feature     | Claude Code | OpenCode | Cursor | Windsurf   | Copilot | Codex CLI  |
|-------------|:-----------:|:--------:|:------:|:----------:|:-------:|:----------:|
| Rules       | yes         | yes      | yes    | yes        | yes     | yes        |
| Agents      | yes         | yes      | yes    | -          | yes     | user-level |
| Skills      | yes         | yes      | yes    | yes        | yes     | yes        |
| Commands    | yes         | yes      | yes    | yes        | yes     | -          |
| MCP Servers | yes         | yes      | yes    | user-level | yes     | user-level |
| Permissions | yes         | yes      | -      | -          | -       | -          |
| Hooks       | yes         | -        | -      | -          | yes     | yes        |
| Formatters  | yes         | yes      | -      | -          | -       | -          |

- **yes** — imported and exported
- **user-level** — the harness stores this outside your repository, in a file harnessport does not read or write
- **-** — not converted; this harness has no equivalent concept

<!-- END:matrix -->

## Quick Start

```sh
npx harnessport convert --from claude --to opencode --source ./my-project
```

## Installation

```sh
npm install -g harnessport
```

Or run without installing:

```sh
npx harnessport <command>
```

## Usage

### Convert between tools

```sh
# Convert Claude Code config to OpenCode
harnessport convert --from claude --to opencode --source ./my-project

# Preview changes without writing files
harnessport convert --from claude --to cursor --source ./my-project --dry-run

# Write output to a different directory
harnessport convert --from claude --to windsurf --source ./project --target ./output

# Machine-readable fidelity report on stdout
harnessport convert --from claude --to cursor --source ./project --json

# Overwrite existing files, keeping a .bak of each
harnessport convert --from claude --to opencode --source ./project --force
```

### Existing files are never silently overwritten

If a file already exists at a target path with different content, the conversion refuses to
touch it, reports it, and exits 2 — the rest of the conversion still completes:

```
BLOCKED
  rule ./AGENTS.md
    a different file already exists at this path; refusing to overwrite it.
    Re-run with --force to replace it, keeping a .bak copy
```

Identical content is a no-op, so re-running a conversion is idempotent rather than a wall of
conflicts. `--force` overwrites, saving the previous content to `<path>.bak` first.

### File-scoped rules survive the trip

A rule scoped to certain files keeps its scope across harnesses, rather than becoming an
always-on instruction:

```
.cursor/rules/typescript.mdc     .claude/rules/typescript.md
---                              ---
globs: src/**/*.ts        <-->   paths:
alwaysApply: false                 - src/**/*.ts
---                              ---
```

Cursor's `globs:`, Windsurf's `globs:`, Copilot's `applyTo:`, and Claude Code's `paths:` all map
to the same canonical field, so `cursor → claude → cursor` returns what you started with.

### Fidelity reporting

Every converted item is classified, so you can see exactly what survived:

| Status | Meaning |
|---------|---------|
| `exact` | Represented fully, nothing dropped |
| `lossy` | Written, but with detail the target cannot hold dropped |
| `dropped` | Not written — the target has no equivalent concept |
| `blocked` | Refused, because writing it would misrepresent the source |

```
Fidelity: 1 exact, 0 lossy, 1 dropped, 2 blocked

  BLOCKED
    permission bash(rm -rf *)
      Cursor cannot express a "deny" permission; refusing to emit it as an allow
```

**Permissions are never weakened.** A `deny` or `ask` rule is never emitted as an `allow`. Where
the target harness has no way to express it, the entry is refused and reported rather than
downgraded — there is no flag that overrides this. The rest of the conversion still completes, so
you get your files plus an accurate account of what did not carry.

### Check the report rather than trusting it

`verify` converts into a temporary directory, reads the result back, and reports what did not
survive — split into loss the conversion admitted and loss it did not. It never writes into the
directory you give it.

```sh
harnessport verify ./my-project --from claude --to cursor
```

```
5 accounted for, 0 unaccounted for

  ACCOUNTED FOR (reported by the conversion)
    permission WebFetch(domain:github.com)
    permission Bash(npm run:*)
    formatter *.{js,ts,jsx,tsx}

Every loss was accounted for.
```

Losing something is ordinary — converting Claude permissions to Cursor loses all of them, by
design. `verify` exits `2` only when something disappears that the fidelity report called `exact`,
which means the report is wrong. It is the same comparison the test suite runs over all 30
conversion paths.

### Keep several harness configs in step

`check` imports every harness configured in a directory and reports where they disagree. It writes
nothing, so it suits a pre-commit hook or a CI job.

```sh
harnessport check ./my-project
```

```
Detected: claude, opencode

2 divergence(s)
  skill testing
    present in claude, absent from opencode
  mcp github
    present in claude, absent from opencode
```

Rules are compared by content, so the same text in `CLAUDE.md` and `AGENTS.md` is agreement rather
than divergence. Exits `2` when the configs have drifted apart, `0` when they agree or when only
one harness is present.

### Exit codes

| Code | `convert` | `verify` | `check` |
|------|-----------|----------|---------|
| `0` | Converted. Items may be `lossy` or `dropped`; both are ordinary. | Every loss was accounted for. | The detected harnesses agree, or only one was found. |
| `1` | Could not run — unknown harness name, identical source and target, or no source config found. | Same. | No harness configuration detected. |
| `2` | One or more items were `blocked` — a refused overwrite, a permission that cannot be expressed without weakening it, or a malformed source file. Other files were still written. | Something was lost that the report called `exact`. | The detected harnesses have diverged. |

Use `--json` as the stable surface for scripting; human-readable output goes to stderr so stdout
stays parseable.

### Detect configured tools

```sh
harnessport detect ./my-project
# Output: Detected: claude, opencode
```

### Show feature matrix

```sh
harnessport list
```

Prints the same table as [Supported Tools](#supported-tools). Both render from each converter's
`capabilities` declaration, so the CLI and the README cannot disagree.

## How It Works

1. **Import** -- reads the source tool's config files into a canonical intermediate format (rules, agents, skills, commands, MCP servers, permissions, hooks, formatters).
2. **Export** -- writes the intermediate format to the target tool's file structure.

Every item is classified as it crosses, so a feature that doesn't map cleanly is reported with its
reason rather than disappearing. See [Fidelity reporting](#fidelity-reporting).

### File Locations by Tool

| Feature  | Claude Code | OpenCode | Cursor | Windsurf | Copilot | Codex CLI |
|----------|-------------|----------|--------|----------|---------|-----------|
| Rules | `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md` | `AGENTS.md` | `.cursor/rules/*.mdc` | `.windsurf/rules/*.md` | `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md` | `AGENTS.md` |
| File-scoped rules | `.claude/rules/*.md` (`paths:`) | - | `.cursor/rules/*.mdc` (`globs:`) | `.windsurf/rules/*.md` (`globs:`) | `.github/instructions/*.instructions.md` (`applyTo:`) | - |
| Agents | `.claude/agents/*.md` | `.opencode/agents/*.md` | `.cursor/agents/*.md` | `AGENTS.md` (partial) | `.github/agents/*.agent.md` | `~/.codex/config.toml` |
| Skills | `.claude/skills/*/SKILL.md` | `.opencode/skills/*/SKILL.md` | `.cursor/skills/*/SKILL.md` | `.windsurf/skills/*/SKILL.md` | `.github/skills/*/SKILL.md` | `.codex/skills/*/SKILL.md` |
| Commands | `.claude/commands/*.md` | `.opencode/commands/*.md` | `.cursor/commands/*.md` | `.windsurf/workflows/*.md` | `.github/prompts/*.prompt.md` | - |
| MCP | `.mcp.json` | `opencode.json` | `.cursor/mcp.json` | `~/.codeium/windsurf/mcp_config.json` | `.copilot/mcp-config.json` | `~/.codex/config.toml` |
| Hooks | `.claude/settings.json` | - | - | - | `.github/hooks/*.json` | `.codex/hooks.json` |

## Architecture

```
src/
  schema.ts              # Canonical intermediate format + fidelity items
  utils.ts               # Frontmatter, file helpers, the single write path
  compare.ts             # Semantic diff behind `verify` and `check`
  matrix.ts              # Converter registry + support matrix rendering
  index.ts               # CLI entry (Commander.js)
  converters/
    types.ts             # Converter interface (capabilities, detect, import, export)
    claude.ts            # Claude Code
    opencode.ts          # OpenCode
    cursor.ts            # Cursor
    windsurf.ts          # Windsurf
    copilot.ts           # GitHub Copilot
    codex.ts             # Codex CLI
scripts/
  sync-readme.ts         # Regenerates the support matrix above
```

Every write goes through `writeIfNotDry` in `utils.ts`, so the never-overwrite rule has one
enforcement point. Every permission decision goes through `permissionStatus` in the same file, so
the never-weaken rule has one too.

## Development

```sh
git clone https://github.com/calghar/harnessport.git
cd harnessport
npm install
```

```sh
npm run dev              # Run CLI with tsx (no build needed)
npm run build            # Compile TypeScript
npm run typecheck        # Type-check src/ and scripts/
npm run lint             # Lint with Biome
npm run test             # Run tests (vitest)
npm run docs:matrix      # Regenerate the support matrix in this file
npm run check            # All checks (typecheck + lint + test + matrix drift)
```

Pre-commit hooks run automatically via husky + lint-staged.

## Contributing

1. Fork the repo and create a feature branch
2. Make your changes
3. Ensure `npm run check` passes
4. Open a pull request

## License

MIT

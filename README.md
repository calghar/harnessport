# harnessport

Convert AI coding harness configurations between tools. Supports rules, agents, skills, commands, MCP servers, permissions, hooks, and formatters.

## Install

```sh
npm install -g harnessport
npx harnessport <command>   # or run without installing
```

## Quick start

```sh
npx harnessport convert --from claude --to opencode --source ./my-project
```

It writes the OpenCode files and prints a fidelity summary:

```
Fidelity: 1 exact, 0 lossy, 1 dropped, 2 blocked
```

## Common tasks

```sh
harnessport convert --from claude --to cursor --source ./my-project --dry-run   # Preview without writing
harnessport convert --from claude --to codex --source ./project --target ./output   # Write to another directory
harnessport convert --from claude --to cursor --source ./project --json   # Fidelity report as JSON on stdout
harnessport convert --from claude --to opencode --source ./project --force   # Overwrite, keeping a .bak
harnessport verify ./my-project --from claude --to cursor   # Check the fidelity report is honest
harnessport check ./my-project   # Find drift between harness configs
harnessport detect ./my-project   # Print the configured tools, for example "Detected: claude, opencode"
```

## Supported tools

Generated from each converter's own declaration, and a test asserts every cell. Run `npm run docs:matrix` to regenerate.

<!-- BEGIN:matrix -->

| Feature     | Claude Code | OpenCode | Cursor | Copilot | Codex CLI  |
|-------------|:-----------:|:--------:|:------:|:-------:|:----------:|
| Rules       | yes         | yes      | yes    | yes     | yes        |
| Agents      | yes         | yes      | yes    | yes     | user-level |
| Skills      | yes         | yes      | yes    | yes     | yes        |
| Commands    | yes         | yes      | yes    | yes     | -          |
| MCP Servers | yes         | yes      | yes    | yes     | user-level |
| Permissions | yes         | yes      | yes    | -       | -          |
| Hooks       | yes         | -        | yes    | yes     | yes        |
| Formatters  | yes         | yes      | yes    | -       | -          |

- **yes** — imported and exported
- **user-level** — the harness stores this outside your repository, in a file harnessport does not read or write
- **-** — not converted; this harness has no equivalent concept

<!-- END:matrix -->

## Usage

| Flag | Effect |
|------|--------|
| `--from <tool>` | Source harness (required) |
| `--to <tool>` | Target harness (required) |
| `--source <dir>` | Source directory, default `.` |
| `--target <dir>` | Target directory, defaults to the source directory |
| `--dry-run` | Show what would be created without writing files |
| `--json` | Emit the fidelity report as JSON on stdout |
| `--force` | Overwrite existing files, saving each previous file to `<path>.bak` |
| `--log-model` | Cursor only. Log the active model once per finished task |

With `--to cursor`, `--log-model` adds a `stop` wrapper that appends the active model to `.cursor/harnessport-model.jsonl` once per finished task. Add that file to `.gitignore`.

Use `--json` as the stable surface for scripting. Human-readable output goes to stderr so stdout stays parseable.

### Existing files are never silently overwritten

A different file at a target path is left alone and reported as `BLOCKED`. The conversion still completes and exits 2.

- Identical content is a no-op, so re-running a conversion is idempotent.
- `--force` replaces the file and saves the previous content to `<path>.bak`.

### File-scoped rules survive the trip

A scoped rule keeps its scope across harnesses rather than becoming an always-on instruction. Cursor's `globs:`, Copilot's `applyTo:`, and Claude Code's `paths:` map to the same canonical field. So `cursor → claude → cursor` returns what you started with.

### Fidelity reporting

| Status | Meaning |
|---------|---------|
| `exact` | Represented fully, nothing dropped |
| `lossy` | Written, but with detail the target cannot hold dropped |
| `dropped` | Not written, because the target has no equivalent concept |
| `blocked` | Refused, because writing it would misrepresent the source |

**Permissions are never weakened.** A `deny` or `ask` rule is never emitted as an `allow`, and no flag overrides this.

- If the target cannot express the rule, the entry is refused and reported rather than downgraded.
- The rest of the conversion still completes, so you get your files plus an account of what did not carry.

**Cursor permissions:**
- Documented `Shell`, `Read`, `Write`, `WebFetch`, and `Mcp` allow and deny tokens are mapped.
- Claude MCP `ask` entries use `beforeMCPExecution` wrappers. Other `ask` entries are blocked.
- At user level, only the permission arrays in `~/.cursor/cli-config.json` are replaced. Other Cursor CLI settings are preserved.

**Hook fidelity.** A guardrail is a hook on `PreToolUse`, `PermissionRequest` or `UserPromptSubmit`.

- A target that cannot write or enforce a guardrail reports it `blocked`, and `convert` exits `2`.
- Any other hook the target cannot write is `dropped`, and the exit code is unchanged.

Cursor runs hooks through Node wrappers:
| Claude Code hook | Cursor event | Notes |
|------------------|--------------|-------|
| Shell guardrail | `beforeShellExecution` | |
| `Read` guardrail | `beforeReadFile` | `lossy` |
| `Agent` guardrail | `preToolUse`, matcher `Subagent` | The wrapper renames that tool to `Agent` so the brief in `tool_input.prompt` reaches the hook |
| Other tool guardrails | `preToolUse` | |
| `Notification` | None | `dropped`, Cursor has no `Notification` event |

The `Read` guardrail works in three parts:
- A `preToolUse` wrapper marks each agent read by `tool_use_id`. `beforeReadFile` enforces only marked reads, so Cursor's own whole-file reads for edits pass.
- A read whose `preToolUse` never ran is allowed, and that event order is unverified. The wrapper recovers the `Read` range from the content line count.

A hook command runs twice when `.claude/settings.json` also holds it and Cursor's Third-Party Imports is on. In the IDE, turning that setting off stops the second run. The Cursor CLI has no opt-out, so there the command always runs twice.

### Verify the report

`verify` converts into a temporary directory, reads the result back, and splits loss into what the conversion admitted and what it did not. It never writes into the directory you give it.

Most conversions lose something. `verify` exits `2` only when something disappears that the report called `exact`, which means the report is wrong. The test suite runs the same comparison over all 20 conversion paths.

### Keep harness configs in step

`check` imports every harness configured in a directory and reports where they disagree. It writes nothing, so it suits a pre-commit hook or a CI job.

Rules are compared by content, so the same text in `CLAUDE.md` and `AGENTS.md` is agreement rather than divergence.

### Exit codes

| Code | `convert` | `verify` | `check` |
|------|-----------|----------|---------|
| `0` | Converted. Items may be `lossy` or `dropped`, and both are ordinary. | Every loss was accounted for. | The detected harnesses agree, or only one was found. |
| `1` | Could not run: unknown harness name, identical source and target, or no source config found. | Same. | No harness configuration detected. |
| `2` | One or more items were `blocked`: a refused overwrite, a permission that cannot be expressed without weakening it, or a malformed source file. Other files were still written. | Something was lost that the report called `exact`. | The detected harnesses have diverged. |

## How it works

Harnessport imports the source tool's config files into a canonical intermediate format (rules, agents, skills, commands, MCP servers, permissions, hooks, formatters). It then exports that format to the target tool's file structure. Every item is classified as it crosses. A feature that does not map cleanly is reported with its reason, as in [Fidelity reporting](#fidelity-reporting). `harnessport list` and the table above both render from each converter's `capabilities` declaration, so the CLI and the README cannot disagree.

### File locations by tool

| Feature  | Claude Code | OpenCode | Cursor | Copilot | Codex CLI |
|----------|-------------|----------|--------|---------|-----------|
| Rules | `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md` | `AGENTS.md` | `.cursor/rules/*.mdc` | `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md` | `AGENTS.md` |
| File-scoped rules | `.claude/rules/*.md` (`paths:`) | - | `.cursor/rules/*.mdc` (`globs:`) | `.github/instructions/*.instructions.md` (`applyTo:`) | - |
| Agents | `.claude/agents/*.md` | `.opencode/agents/*.md` | `.cursor/agents/*.md` | `.github/agents/*.agent.md` | `~/.codex/config.toml` |
| Skills | `.claude/skills/*/SKILL.md` | `.opencode/skills/*/SKILL.md` | `.cursor/skills/*/SKILL.md` | `.github/skills/*/SKILL.md` | `.codex/skills/*/SKILL.md` |
| Commands | `.claude/commands/*.md` | `.opencode/commands/*.md` | `.cursor/commands/*.md` | `.github/prompts/*.prompt.md` | - |
| MCP | `.mcp.json` | `opencode.json` | `.cursor/mcp.json` | `.github/mcp.json` | `~/.codex/config.toml` |
| Hooks | `.claude/settings.json` | - | `.cursor/hooks.json` (Node wrappers) | `.github/hooks/*.json` (`version: 1`) | `.codex/hooks.json` |

### Architecture

| Path | Role |
|------|------|
| `src/schema.ts` | Canonical intermediate format + fidelity items |
| `src/utils.ts` | Frontmatter, file helpers, the single write path |
| `src/compare.ts` | Semantic diff behind `verify` and `check` |
| `src/matrix.ts` | Converter registry + support matrix rendering |
| `src/index.ts` | CLI entry (Commander.js) |
| `src/converters/` | `types.ts` (converter interface: capabilities, detect, import, export) and one file per harness: `claude`, `opencode`, `cursor`, `copilot`, `codex` |
| `scripts/sync-readme.ts` | Regenerates the support matrix above |

- Every write goes through `writeIfNotDry` in `utils.ts`, so the never-overwrite rule has one enforcement point.
- Every permission decision goes through `permissionStatus` in the same file, so the never-weaken rule has one too.
- Copilot round trips preserve imported hook JSON basenames and grouping. Hooks from other sources use `.github/hooks/hooks.json`.

## Development

```sh
git clone https://github.com/calghar/harnessport.git
cd harnessport
npm install
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

Fork the repo and create a feature branch. Make your changes. Ensure `npm run check` passes. Open a pull request.

## License

MIT

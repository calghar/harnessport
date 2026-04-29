# harnessport

Convert AI coding harness configurations between tools. Supports rules, agents, skills, commands, MCP servers, permissions, hooks, and formatters.

## Supported Tools

| Feature     | Claude Code | OpenCode | Cursor | Windsurf | Copilot | Codex CLI |
|-------------|:-----------:|:--------:|:------:|:--------:|:-------:|:---------:|
| Rules       | yes         | yes      | yes    | yes      | yes     | yes       |
| Agents      | yes         | yes      | yes    | partial  | yes     | partial   |
| Skills      | yes         | yes      | yes    | yes      | yes     | yes       |
| Commands    | yes         | yes      | yes    | yes      | yes     | -         |
| MCP Servers | yes         | yes      | yes    | partial  | yes     | partial   |
| Permissions | yes         | yes      | -      | -        | -       | partial   |
| Hooks       | yes         | partial  | -      | -        | yes     | yes       |
| Formatters  | partial     | yes      | -      | -        | -       | -         |

- **yes** = full bidirectional import/export
- **partial** = feature exists but user-level config, limited mapping, or no per-agent tool config
- **-** = tool has no equivalent concept

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
```

### Detect configured tools

```sh
harnessport detect ./my-project
# Output: Detected: claude, opencode
```

### Show feature matrix

```sh
harnessport list
```

## How It Works

1. **Import** -- reads the source tool's config files into a canonical intermediate format (rules, agents, skills, commands, MCP servers, permissions, hooks, formatters).
2. **Export** -- writes the intermediate format to the target tool's file structure.

Features that don't map cleanly between tools produce warnings explaining what was dropped or partially converted.

### File Locations by Tool

| Feature  | Claude Code | OpenCode | Cursor | Windsurf | Copilot | Codex CLI |
|----------|-------------|----------|--------|----------|---------|-----------|
| Rules | `.claude/CLAUDE.md` | `AGENTS.md` | `.cursor/rules/*.mdc` | `.windsurf/rules/*.md` | `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md` | `AGENTS.md` |
| Agents | `.claude/agents/*.md` | `.opencode/agents/*.md` | `.cursor/agents/*.md` | `AGENTS.md` (partial) | `.github/agents/*.agent.md` | `~/.codex/config.toml` |
| Skills | `.claude/skills/*/SKILL.md` | `.opencode/skills/*/SKILL.md` | `.cursor/skills/*/SKILL.md` | `.windsurf/skills/*/SKILL.md` | `.github/skills/*/SKILL.md` | `.codex/skills/*/SKILL.md` |
| Commands | `.claude/commands/*.md` | `.opencode/commands/*.md` | `.cursor/commands/*.md` | `.windsurf/workflows/*.md` | `.github/prompts/*.prompt.md` | - |
| MCP | `.mcp.json` | `opencode.json` | `.cursor/mcp.json` | `~/.codeium/windsurf/mcp_config.json` | `.copilot/mcp-config.json` | `~/.codex/config.toml` |
| Hooks | `.claude/settings.json` | - | - | - | `.github/hooks/*.json` | `.codex/hooks.json` |

## Architecture

```
src/
  schema.ts              # Zod canonical schema (intermediate format)
  utils.ts               # Frontmatter parsing, file helpers
  index.ts               # CLI entry (Commander.js)
  converters/
    types.ts             # Converter interface (detect, import, export)
    claude.ts            # Claude Code
    opencode.ts          # OpenCode
    cursor.ts            # Cursor
    windsurf.ts          # Windsurf
    copilot.ts           # GitHub Copilot
    codex.ts             # Codex CLI
```

## Development

```sh
git clone https://github.com/calghar/harnessport.git
cd harnessport
npm install
```

```sh
npm run dev              # Run CLI with tsx (no build needed)
npm run build            # Compile TypeScript
npm run typecheck        # Type-check (tsc --noEmit)
npm run lint             # Lint with Biome
npm run test             # Run tests (vitest)
npm run check            # Run all checks (typecheck + lint + test)
```

Pre-commit hooks run automatically via husky + lint-staged.

## Contributing

1. Fork the repo and create a feature branch
2. Make your changes
3. Ensure `npm run check` passes
4. Open a pull request

## License

MIT

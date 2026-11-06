## Context

Findings come from `tmp/verify-opencode.md` (OpenCode docs, fetched 2026-11-06). All code edits are in `src/converters/opencode.ts`.

## Requirements analysis

Stage 1 (refinement):
- Websearch scenarios are testable; "written" is bound to `opencode.json` content. KEPT.
- "Strictest action wins" is ambiguous when an `allow` with a pattern is flattened. REFINED: only entries cleared for writing count; patterned `deny`/`ask` are already blocked, so the rule reduces to `deny > ask > allow`.
- Domain rule could mean "flatten allow" or "drop allow". REFINED to drop, because flattening widens one domain to every URL.
- Hook reason scenario asserts substrings, not exact text. KEPT.

Stage 2: no conflicts. Completeness gap: shorthand-only tool, pattern `*`, `deny`. Covered by the websearch and lsp scenarios. Unlisted shorthand keys (`todowrite`, `question`, `doom_loop`) follow the same rule; granularity UNVERIFIED.

Stage 3 (decided here, no user available): `websearch` stays shorthand-only (conservative); `domain:` allow is dropped, not flattened.

## Decisions

- `websearch` leaves `UNREPRESENTABLE_TOOLS`; the set becomes empty and is deleted. Shorthand-only because granularity is unverified.
- `GRANULAR_PERMISSIONS` loses `list` and `lsp`. A `list` entry is written like any unknown key, as shorthand.
- Shorthand-only entries with pattern `*` write their action; non-`*` `deny`/`ask` stay `blocked`; non-`*` `allow` stays `lossy`. Rejected: keep blocking every non-allow shorthand entry, since that blocks a representable `websearch: deny`.
- `transformPermissionPattern` is deleted. A `domain:` check in `partitionPermissions` routes to `permissionStatus` with no actions.
- Hook reason text only. Status is owned by `hook-fidelity`.
- Formatter import: `Formatter` has no `disabled`/`environment` field. Skip and report rather than extend `schema.ts`, which all converters share.

## Risks

- A `deny` on `*` for a shorthand tool previously failed the run and now writes. The written form is the exact action, so nothing widens.

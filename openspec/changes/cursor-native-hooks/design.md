## Requirements analysis

| Finding | Resolution |
|---|---|
| `failClosed` and `timeout` on a skipped hook have nowhere to go | Cursor applies the Claude hook's own settings; the item states nothing is written |
| `Read\|Grep` mixes a native and an unverified tool | Wrapped: only `Read` and `Write` are probed, so any other token keeps the wrapper |
| `Read\|Task` | Still `blocked` by the existing unmapped-token rule, checked first |
| Dry run | Writes nothing either way |

## Decisions

- `mapMatcher` adds the offset/limit reason when a token is `Read`, which makes a wrapped `Bash|Read` item `lossy` with no other change.
- `exportHooks` treats a hook as native when its mapped Cursor matcher is not `*` and every `|` part is `Read` or `Write`. It pushes the item and continues before numbering a wrapper.
- Skipped items are kept in a `Set` so the stale-wrapper note and the refused-`hooks.json` downgrade ignore them.
- Rejected: an environment variable to force the wrapper. Out of scope per the request.

## Regression guard

Bash, `*` and no-matcher hooks go through the unchanged path; the existing wrapper tests and the Bash scenarios cover them. Rollback: revert the commit; no on-disk format changes.

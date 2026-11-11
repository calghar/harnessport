## Context

`exportHooks` in `src/converters/cursor.ts` writes two kinds of generated file into `.cursor/hooks/`. `wrapperSource` prefixes `WRAPPER_TEMPLATE` with a `const HOOK = {...};` line and relays a Claude hook. `mcpAskSource` writes a standalone Cursor-only script whose first line is `const MCP_ASK = {...};`. `importHooks` reads that first line back through `generatedWrapperMetadata(file, constant)` to recognise its own output.

Stable boundaries: the bytes of `WRAPPER_TEMPLATE`, the `harnessport-guard-<n>.mjs` numbering and stale scan, the entry order inside `.cursor/hooks.json`, and the `Converter.export` signature.

## Goals / Non-Goals

Goals: one opt-in Cursor `stop` wrapper that appends one JSON line per finished task, with the default export unchanged.

Non-goals: token logging, `model_params`, a Claude-side log and `.gitignore` edits. The proposal lists the reason for each.

## Decisions

Ponytail ladder, applied per decision:

1. **Generator: copy the `mcpAskSource` pattern (rung 2).** A new `modelLogSource()` returns a short script whose first line is `const MODEL_LOG = {"version":1};`. Extending `WRAPPER_TEMPLATE` was rejected: that template follows the Claude contract and runs a Claude command, which this wrapper does not have. A template file on disk was rejected: both existing generators are inline arrays.
2. **File name `harnessport-model-log.mjs`, outside the guard counter.** The guard numbering and the stale-guard regex `^harnessport-guard-(\d+)\.mjs$` stay untouched, which keeps the default export byte-identical.
3. **Log path from `import.meta.url` (rung 3).** `new URL("../harnessport-model.jsonl", import.meta.url)` resolves to `.cursor/harnessport-model.jsonl` beside the hooks directory, at project and user level alike. Reading `cwd` or `workspace_roots` was rejected, because the working directory Cursor gives a hook is [UNVERIFIED].
4. **Write with `appendFileSync` (rung 3).** One call per record. No lock, no rotation.
5. **Flag plumbing.** `ExportOptions` gains `logModel?: boolean`. `src/index.ts` adds `.option("--log-model", ...)` and rejects it unless `--to cursor`, before import runs. Only the Cursor converter reads the field. A config-file key was rejected, because harnessport has no config file today.
6. **Registration.** When `logModel` is set, `exportHooks` writes the wrapper after the guard loop and appends `{ command }` to `eventEntries.stop`, after any relayed `Stop` entries. The early return `if (written === 0 && formatters.length === 0)` also checks `logModel`, so a project with no hooks still gets `hooks.json`. The entry carries no `timeout` or `failClosed`.
7. **Import.** `generatedWrapperMetadata` accepts `"MODEL_LOG"`. `importHooks` checks for it before the `HOOK` branch and pushes one `dropped` item with the reason fixed in the spec.
8. **Failure handling.** The wrapper wraps parse and append in `try`, writes `harnessport-model-log: <message>` to stderr on error, and never sets a non-zero exit code. Cursor `stop` output can carry `followup_message`; the wrapper prints nothing, so it never adds a follow-up.

Wrapper body (inline array in `cursor.ts`, about 12 lines):

```js
const MODEL_LOG = {"version":1};
import { appendFileSync, readFileSync } from "node:fs";
const KEYS = ["conversation_id", "generation_id", "model", "model_id"];
try {
  const input = JSON.parse(readFileSync(0, "utf-8"));
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("stdin is not a JSON object");
  const line = { timestamp: new Date().toISOString() };
  for (const k of KEYS) if (input[k] !== undefined) line[k] = input[k];
  appendFileSync(new URL("../harnessport-model.jsonl", import.meta.url), JSON.stringify(line) + "\n");
} catch (e) { process.stderr.write("harnessport-model-log: " + e.message + "\n"); }
```

Skipped: log rotation and a reader command. Add them when the log size or a consumer needs them.

## Risks / Trade-offs

- [Default export drifts] → Every branch is gated on `logModel`; the byte-identical scenario runs the `sample-project` fixture without the flag against its committed output.
- [The 56 existing `.export(` test calls] → None passes `logModel`, so they exercise the unchanged path and act as the regression guard.
- [`verify` in `src/index.ts:215`] → Passes `{}`; it never writes the model log and never sees the new entry.
- [Other five converters] → The optional field is ignored; their signatures do not change.
- [Importer misreads the new wrapper] → The `MODEL_LOG` check runs before the `HOOK` check, so the "not a generated harnessport guard" item is not emitted for it.
- [Concurrent `stop` events] → Each record is one append under 4 KiB; atomic on a local POSIX file system, [UNVERIFIED] on synced folders.
- [Cursor payload field names change] → Absent fields are omitted, so the wrapper keeps writing `timestamp` and whatever remains.

## Migration Plan

No migration. Existing exports keep their output. Users opt in by re-running `convert` with `--log-model`. Rollback is a re-run without the flag, which removes the `stop` entry; the wrapper file stays until deleted by hand (proposal Q6).

## Open Questions

Recorded in proposal.md, Q1 to Q6, each with a default.

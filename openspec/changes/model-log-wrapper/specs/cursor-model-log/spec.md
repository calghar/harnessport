## ADDED Requirements

### Requirement: Opt-in model-log export
WHEN `harnessport convert --to cursor` runs with `--log-model`, the export SHALL write `.cursor/hooks/harnessport-model-log.mjs`, SHALL add one entry under `hooks.stop` in `.cursor/hooks.json` whose command runs that file with `node`, and SHALL report the model log as `exact` in the fidelity report.

#### Scenario: Project-level export writes the wrapper and the stop entry
- **GIVEN** a Claude project with no hooks
- **WHEN** `harnessport convert --from claude --to cursor --log-model` runs on it
- **THEN** `.cursor/hooks/harnessport-model-log.mjs` exists
- **AND** `.cursor/hooks.json` `hooks.stop` holds an entry with command `node .cursor/hooks/harnessport-model-log.mjs`
- **AND** the fidelity report holds a `model-log` item with status `exact`

#### Scenario: User-level export uses the quoted absolute path
- **GIVEN** the export target is the home directory
- **WHEN** the Cursor export runs with the model log requested
- **THEN** the `hooks.stop` entry command is `node "<home>/.cursor/hooks/harnessport-model-log.mjs"`

#### Scenario: Dry run writes nothing
- **GIVEN** a Claude project with no hooks
- **WHEN** `harnessport convert --from claude --to cursor --log-model --dry-run` runs on it
- **THEN** no file is created under `.cursor/`

### Requirement: Default export is unchanged
WHEN the Cursor export runs without `--log-model`, it SHALL write the same set of files with the same bytes as the same export before this change, and no written file SHALL reference `harnessport-model-log`.

#### Scenario: Export without the flag matches the previous output
- **GIVEN** the `sample-project` fixture with Claude hooks and permissions
- **WHEN** `harnessport convert --from claude --to cursor` runs without `--log-model`
- **THEN** every written file is byte-identical to the committed expected output
- **AND** no written file contains the text `harnessport-model-log`

### Requirement: One record per finished task
WHEN Cursor runs the model-log wrapper for a `stop` event with a JSON object on stdin, the wrapper SHALL append exactly one line to `.cursor/harnessport-model.jsonl` in the same `.cursor` directory as the wrapper. The line SHALL be one JSON object holding `timestamp` as an ISO-8601 UTC string, plus each of `conversation_id`, `generation_id`, `model` and `model_id` that the payload carries, copied unchanged. A field absent from the payload SHALL be absent from the line.

#### Scenario: Payload fields are recorded
- **GIVEN** a generated model-log wrapper
- **WHEN** it receives a stop payload with `conversation_id` `<conversation>`, `generation_id` `<generation>`, `model` `<model>` and `model_id` `<model_id>`
- **THEN** `.cursor/harnessport-model.jsonl` gains exactly one line
- **AND** the line parses as JSON with a `timestamp` string ending in `Z`
- **AND** the line holds exactly the keys `<keys>`

#### Examples:
| conversation | generation | model | model_id | keys |
| c-1 | g-1 | claude-sonnet | id-1 | timestamp,conversation_id,generation_id,model,model_id |
| c-2 | (absent) | gpt-5 | id-2 | timestamp,conversation_id,model,model_id |

### Requirement: The wrapper never blocks the agent
The model-log wrapper SHALL exit with status 0 and SHALL write nothing to stdout. IF the log file cannot be written, or stdin is not a JSON object, THEN the wrapper SHALL write exactly one line to stderr starting with `harnessport-model-log:` and SHALL append no record.

#### Scenario: Failure cases exit 0 with one stderr line
- **GIVEN** a generated model-log wrapper
- **WHEN** it runs with <condition>
- **THEN** its exit status is 0
- **AND** its stdout is empty
- **AND** its stderr is one line starting with `harnessport-model-log:`

#### Examples:
| condition |
| a read-only .cursor directory |
| stdin that is not JSON |
| stdin that is a JSON array |

### Requirement: Model log requires the Cursor target
IF `harnessport convert` runs with `--log-model` and a `--to` value other than `cursor`, THEN it SHALL exit with status 1, SHALL print an error naming `--log-model`, and SHALL write no file.

#### Scenario: Non-Cursor target is rejected
- **GIVEN** a Claude project
- **WHEN** `harnessport convert --from claude --to codex --log-model` runs on it
- **THEN** the exit status is 1
- **AND** stderr contains `--log-model`
- **AND** no file is written in the project

### Requirement: Import reports the model log as dropped
WHEN the Cursor importer reads a `.cursor/hooks.json` entry that runs a generated model-log wrapper, it SHALL produce no Claude hook for that entry and SHALL report one `dropped` hook item with reason `the harnessport model log is Cursor-only and has no Claude hook mapping`.

#### Scenario: Round trip drops the model log with its reason
- **GIVEN** a Cursor project exported with `--log-model`
- **WHEN** `harnessport convert --from cursor --to claude` runs on it
- **THEN** `.claude/settings.json` holds no `Stop` hook running `harnessport-model-log`
- **AND** the fidelity report holds one `dropped` item with that reason

### Requirement: Coexistence with relayed Stop hooks
WHEN the export runs with `--log-model` and the source holds Claude `Stop` hooks, `hooks.stop` SHALL hold the relayed `Stop` wrapper entries in their existing order followed by the model-log entry, and the guard wrapper file names SHALL match those written without the flag.

#### Scenario: Stop hooks keep order and numbering
- **GIVEN** a Claude project with one `Stop` hook
- **WHEN** the Cursor export runs with `--log-model`
- **THEN** `hooks.stop` holds two entries, `node .cursor/hooks/harnessport-stop.mjs` then `node .cursor/hooks/harnessport-model-log.mjs`

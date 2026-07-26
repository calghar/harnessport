// --- The support matrix, in every rendering ---
//
// `harnessport list`, the README table, and the converters used to be three hand-written
// descriptions of the same thing, and they disagreed: the CLI reported `-` for Cursor agents and
// Copilot hooks while both converters implemented them. Everything here renders from
// `Converter.capabilities`, so the tables cannot drift from each other again — and
// `tests/capabilities.test.ts` checks the declarations against what the exporters actually report,
// so they cannot drift from the code either.

import * as fs from "node:fs";
import { claudeConverter } from "./converters/claude.js";
import { opencodeConverter } from "./converters/opencode.js";
import { cursorConverter } from "./converters/cursor.js";
import { windsurfConverter } from "./converters/windsurf.js";
import { copilotConverter } from "./converters/copilot.js";
import { codexConverter } from "./converters/codex.js";
import type { Capability, Converter } from "./converters/types.js";
import type { Feature } from "./schema.js";

/** Every converter, in column order. The one registry — `CONVERTERS` is derived from it. */
export const ALL_CONVERTERS: Converter[] = [
  claudeConverter,
  opencodeConverter,
  cursorConverter,
  windsurfConverter,
  copilotConverter,
  codexConverter,
];

/** Lookup by the `--from` / `--to` name. */
export const CONVERTERS: Record<string, Converter> = Object.fromEntries(
  ALL_CONVERTERS.map((c) => [c.name, c]),
);

/** Row order, and the display name of each feature. */
const FEATURE_ROWS: Array<[Feature, string]> = [
  ["rule", "Rules"],
  ["agent", "Agents"],
  ["skill", "Skills"],
  ["command", "Commands"],
  ["mcp", "MCP Servers"],
  ["permission", "Permissions"],
  ["hook", "Hooks"],
  ["formatter", "Formatters"],
];

const SYMBOLS: Record<Capability, string> = {
  full: "✓",
  "user-level": "~",
  none: "-",
};

const WORDS: Record<Capability, string> = {
  full: "yes",
  "user-level": "user-level",
  none: "-",
};

const LEGEND: Array<[Capability, string]> = [
  ["full", "imported and exported"],
  [
    "user-level",
    "the harness stores this outside your repository, in a file harnessport does not read or write",
  ],
  ["none", "not converted; this harness has no equivalent concept"],
];

function headerRow(): string[] {
  return ["Feature", ...ALL_CONVERTERS.map((c) => c.label)];
}

function bodyRows(cell: (c: Capability) => string): string[][] {
  return FEATURE_ROWS.map(([feature, label]) => [
    label,
    ...ALL_CONVERTERS.map((c) => cell(c.capabilities[feature])),
  ]);
}

function columnWidths(rows: string[][]): number[] {
  return rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
}

function centre(text: string, width: number): string {
  const left = Math.floor((width - text.length) / 2);
  return " ".repeat(left) + text + " ".repeat(width - text.length - left);
}

/** The `harnessport list` table: symbols, centred, with a legend. */
export function renderCliMatrix(): string {
  const header = headerRow();
  const body = bodyRows((c) => SYMBOLS[c]);
  const widths = columnWidths([header, ...body]);
  const line = (cells: string[]) =>
    cells
      .map((cell, i) => (i === 0 ? cell.padEnd(widths[i]) : centre(cell, widths[i])))
      .join(" | ");

  return [
    line(header),
    widths.map((w) => "-".repeat(w)).join("-|-"),
    ...body.map(line),
    "",
    ...LEGEND.map(([capability, meaning]) => `${SYMBOLS[capability]} = ${meaning}`),
  ].join("\n");
}

/** The README table: words, GitHub-flavoured markdown, with the same legend as a list. */
export function renderReadmeMatrix(): string {
  const header = headerRow();
  const body = bodyRows((c) => WORDS[c]);
  const widths = columnWidths([header, ...body]);
  const line = (cells: string[]) =>
    `| ${cells.map((cell, i) => cell.padEnd(widths[i])).join(" | ")} |`;

  return [
    line(header),
    `|${widths.map((w, i) => (i === 0 ? "-".repeat(w + 2) : `:${"-".repeat(w)}:`)).join("|")}|`,
    ...body.map(line),
    "",
    ...LEGEND.map(
      ([capability, meaning]) => `- **${WORDS[capability]}** — ${meaning}`,
    ),
  ].join("\n");
}

const BEGIN = "<!-- BEGIN:matrix -->";
const END = "<!-- END:matrix -->";

export interface SyncOutcome {
  drifted: boolean;
  message?: string;
}

/**
 * Rewrite the marked matrix region of a README, or report that it is stale.
 *
 * Only the region between the markers is generated; the rest of the file stays hand-written.
 */
export function syncReadme(
  filePath: string,
  options: { check: boolean },
): SyncOutcome {
  const raw = fs.readFileSync(filePath, "utf-8");
  const start = raw.indexOf(BEGIN);
  const end = raw.indexOf(END);
  if (start < 0 || end < 0) {
    throw new Error(`${filePath} has no ${BEGIN} / ${END} region to generate into`);
  }

  const desired = `${BEGIN}\n\n${renderReadmeMatrix()}\n\n${END}`;
  if (raw.slice(start, end + END.length) === desired) return { drifted: false };

  if (options.check) {
    return {
      drifted: true,
      message: `${filePath} does not match Converter.capabilities. Run \`npm run docs:matrix\`.`,
    };
  }

  fs.writeFileSync(filePath, raw.slice(0, start) + desired + raw.slice(end + END.length));
  return { drifted: true };
}

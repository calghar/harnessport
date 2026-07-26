// --- Semantic comparison of canonical configs ---
//
// The fidelity report says what a conversion *claims* it lost. This is what checks that claim
// against what a conversion actually loses, and it is the property the whole tool rests on:
// anything that disappears must be named by an item that admits it disappeared.
//
// `harnessport verify`, `harnessport check`, and tests/matrix.test.ts all compare through here,
// so a command and its test cannot disagree about what counts as loss.

import type { Feature, FidelityItem, HarnessConfig } from "./schema.js";

/** One named thing that did not survive, or that one harness has and another does not. */
export interface Lost {
  kind: Feature;
  name: string;
}

export interface RoundTripLoss {
  /** Lost, and named by a fidelity item that admits it. The tool working correctly. */
  accounted: Lost[];
  /** Lost with no fidelity item naming it. The fidelity report is wrong. */
  unaccounted: Lost[];
}

export interface Divergence extends Lost {
  presentIn: string;
  absentFrom: string;
}

/**
 * The named things a config holds, keyed by feature.
 *
 * Names match how the fidelity report names the same things — `Tool(pattern)` for permissions,
 * the glob for formatters — because the two are compared against each other. A misaligned key
 * manufactures loss that is not real: the first draft of this comparison reported 26 losses, of
 * which 22 were its own key mismatch.
 *
 * Rules are absent here deliberately; they are compared by content, see `ruleTextLost`.
 */
export function inventory(config: HarnessConfig): Record<Feature, string[]> {
  return {
    rule: [],
    agent: config.agents.map((a) => a.name),
    skill: config.skills.map((s) => s.name),
    command: config.commands.map((c) => c.name),
    mcp: config.mcpServers.map((s) => s.name),
    permission: config.permissions.map((p) => `${p.tool}(${p.pattern})`),
    hook: config.hooks.map((h) => h.event),
    formatter: config.formatters.map((f) => f.glob),
  };
}

/**
 * Permission tool names are compared case-insensitively: OpenCode's config keys are legitimately
 * lowercase, and calling that a loss would bury the real signal. Whether such a name *matches* in
 * the target is a different question, fixed on import rather than hidden here.
 */
function includesName(names: string[], name: string): boolean {
  return names.some((n) => n.toLowerCase() === name.toLowerCase());
}

/**
 * Rules that did not survive.
 *
 * Several exporters concatenate every rule into one file (`AGENTS.md`, `CLAUDE.md`), so after a
 * round trip the target holds one rule containing all of the source's text. Set equality would
 * call every rule lost on those paths; containment is the property that actually holds.
 */
function ruleTextLost(
  source: HarnessConfig,
  target: HarnessConfig,
): Lost[] {
  const joined = target.rules.map((r) => r.content).join("\n");
  return source.rules
    .filter((r) => !joined.includes(r.content.trim()))
    .map((r) => ({ kind: "rule" as const, name: r.source ?? "project-rules" }));
}

/**
 * Split what a round trip lost into the part its fidelity report admitted and the part it did not.
 *
 * An item is accounted for when a fidelity item of the same kind names it with a status other
 * than `exact`. Loss itself is ordinary — converting Claude permissions to Cursor loses all of
 * them, correctly and by design. Loss the report called `exact` is the defect.
 */
export function roundTripLoss(
  source: HarnessConfig,
  target: HarnessConfig,
  items: FidelityItem[],
): RoundTripLoss {
  const before = inventory(source);
  const after = inventory(target);

  const lost: Lost[] = [
    ...ruleTextLost(source, target),
    ...Object.entries(before).flatMap(([kind, names]) =>
      names
        .filter((name) => !includesName(after[kind as Feature], name))
        .map((name) => ({ kind: kind as Feature, name })),
    ),
  ];

  const accounted: Lost[] = [];
  const unaccounted: Lost[] = [];
  for (const entry of lost) {
    const admitted = items.some(
      (i) =>
        i.kind === entry.kind &&
        i.status !== "exact" &&
        i.name.toLowerCase() === entry.name.toLowerCase(),
    );
    (admitted ? accounted : unaccounted).push(entry);
  }

  return { accounted, unaccounted };
}

/**
 * Where the harness configs in one repository disagree, reported pairwise and with direction —
 * "present in claude, absent from opencode" is actionable, "these differ" is not.
 */
export function divergences(
  configs: Array<{ harness: string; config: HarnessConfig }>,
): Divergence[] {
  const out: Divergence[] = [];

  for (const a of configs) {
    for (const b of configs) {
      if (a === b) continue;
      for (const rule of ruleTextLost(a.config, b.config)) {
        out.push({ ...rule, presentIn: a.harness, absentFrom: b.harness });
      }
      const inventoryA = inventory(a.config);
      const inventoryB = inventory(b.config);
      for (const [kind, names] of Object.entries(inventoryA)) {
        for (const name of names) {
          if (includesName(inventoryB[kind as Feature], name)) continue;
          out.push({
            kind: kind as Feature,
            name,
            presentIn: a.harness,
            absentFrom: b.harness,
          });
        }
      }
    }
  }

  return out;
}

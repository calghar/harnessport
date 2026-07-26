// --- Canonical intermediate schema ---
//
// Plain types, not a validation library. Every value here is constructed by our own importers,
// which the compiler already checks; nothing arrives from the network. The one place runtime
// checking matters is reading a user's config file, and there the requirement is only to tell
// "absent" from "malformed" — which `JSON.parse` throwing already answers. Validating shape on
// top of that would reject configs that are structurally fine but unexpected, which is the wrong
// instinct for a tool whose job is to be liberal in what it accepts.

export interface Rule {
  content: string;
  source?: string; // original filename
  description?: string; // for agent-requested activation (Cursor/Windsurf)
  globs?: string; // file-scoped activation pattern
  alwaysApply?: boolean; // always-on activation flag
}

export interface Agent {
  name: string;
  description?: string;
  model?: string;
  body: string; // markdown body (post-frontmatter)
  skills?: string[];
  tools?: string[];
  // OpenCode-specific fields preserved for round-trip
  mode?: "primary" | "subagent";
  temperature?: number;
  permissions?: Record<string, string | Record<string, string>>;
}

export interface Skill {
  name: string;
  description?: string;
  body: string; // markdown body
}

export interface Command {
  name: string;
  description?: string;
  body: string; // markdown body
  allowedTools?: string[]; // Claude-specific
  agent?: string; // OpenCode-specific
}

export interface McpServer {
  name: string;
  type: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  enabled?: boolean;
}

export type PermissionAction = "allow" | "ask" | "deny";

export interface PermissionEntry {
  tool: string; // e.g. "Bash", "WebFetch", "WebSearch"
  pattern: string; // e.g. "git add *", "domain:github.com"
  // Sources that express no action import as "allow". A deny/ask is never emitted as an
  // allow — a target that cannot represent it blocks the entry instead. See permissionStatus.
  action: PermissionAction;
}

export interface Hook {
  event: string; // e.g. "PostToolUse"
  matcher?: string; // e.g. "Edit|Write|MultiEdit"
  command: string;
}

export interface Formatter {
  glob: string;
  command: string;
}

/**
 * The eight things a harness config can hold.
 *
 * Named rather than left inline because `Converter.capabilities` is keyed by it: a ninth feature
 * then breaks every converter at compile time until each declares what it does with it, instead of
 * being added to the fidelity report and forgotten in the support matrix.
 */
export type Feature =
  | "rule"
  | "agent"
  | "skill"
  | "command"
  | "mcp"
  | "permission"
  | "hook"
  | "formatter";

/**
 * One thing that crossed (or failed to cross) a conversion boundary.
 *
 * `exact`   — represented fully, nothing dropped.
 * `lossy`   — written, but with detail the target cannot hold dropped.
 * `dropped` — not written, because the target has no equivalent concept. Expected, not an error.
 * `blocked` — refused, because writing it would misrepresent the source, weaken a security
 *             posture, or destroy an existing file. Exceptional: the only status that fails the
 *             run (exit 2).
 *
 * The `dropped`/`blocked` split is what makes the exit code meaningful. Windsurf having no
 * agent concept is ordinary; declining to rewrite a deny rule as an allow is not.
 *
 * This is the single representation of conversion fidelity: human output and `--json` both
 * render from it, so they cannot disagree.
 */
export interface FidelityItem {
  phase: "import" | "export";
  kind: Feature;
  name: string;
  status: "exact" | "lossy" | "dropped" | "blocked";
  reason?: string; // required in practice for anything but "exact"
}

export interface HarnessConfig {
  rules: Rule[];
  agents: Agent[];
  skills: Skill[];
  commands: Command[];
  mcpServers: McpServer[];
  permissions: PermissionEntry[];
  hooks: Hook[];
  formatters: Formatter[];
  items: FidelityItem[];
}

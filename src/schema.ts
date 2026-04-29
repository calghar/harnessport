import { z } from "zod";

// --- Canonical intermediate schema ---

export const RuleSchema = z.object({
  content: z.string(),
  source: z.string().optional(), // original filename
  description: z.string().optional(), // for agent-requested activation (Cursor/Windsurf)
  globs: z.string().optional(), // file-scoped activation pattern
  alwaysApply: z.boolean().optional(), // always-on activation flag
});

export const AgentSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  model: z.string().optional(),
  body: z.string(), // markdown body (post-frontmatter)
  skills: z.array(z.string()).optional(),
  tools: z.array(z.string()).optional(),
  // OpenCode-specific fields preserved for round-trip
  mode: z.enum(["primary", "subagent"]).optional(),
  temperature: z.number().optional(),
  permissions: z
    .record(z.string(), z.union([z.string(), z.record(z.string(), z.string())]))
    .optional(),
});

export const SkillSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  body: z.string(), // markdown body
});

export const CommandSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  body: z.string(), // markdown body
  allowedTools: z.array(z.string()).optional(), // Claude-specific
  agent: z.string().optional(), // OpenCode-specific
});

export const McpServerSchema = z.object({
  name: z.string(),
  type: z.enum(["stdio", "http"]),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional(),
});

export const PermissionEntrySchema = z.object({
  tool: z.string(), // e.g. "Bash", "WebFetch", "WebSearch"
  pattern: z.string(), // e.g. "git add *", "domain:github.com"
});

export const HookSchema = z.object({
  event: z.string(), // e.g. "PostToolUse"
  matcher: z.string().optional(), // e.g. "Edit|Write|MultiEdit"
  command: z.string(),
});

export const FormatterSchema = z.object({
  glob: z.string(),
  command: z.string(),
});

export const HarnessConfigSchema = z.object({
  rules: z.array(RuleSchema).default([]),
  agents: z.array(AgentSchema).default([]),
  skills: z.array(SkillSchema).default([]),
  commands: z.array(CommandSchema).default([]),
  mcpServers: z.array(McpServerSchema).default([]),
  permissions: z.array(PermissionEntrySchema).default([]),
  hooks: z.array(HookSchema).default([]),
  formatters: z.array(FormatterSchema).default([]),
  warnings: z.array(z.string()).default([]),
});

// Inferred types
export type Rule = z.infer<typeof RuleSchema>;
export type Agent = z.infer<typeof AgentSchema>;
export type Skill = z.infer<typeof SkillSchema>;
export type Command = z.infer<typeof CommandSchema>;
export type McpServer = z.infer<typeof McpServerSchema>;
export type PermissionEntry = z.infer<typeof PermissionEntrySchema>;
export type Hook = z.infer<typeof HookSchema>;
export type Formatter = z.infer<typeof FormatterSchema>;
export type HarnessConfig = z.infer<typeof HarnessConfigSchema>;

import type {
  Feature,
  FidelityItem,
  HarnessConfig,
  PermissionAction,
} from "../schema.js";

/**
 * Permission actions a harness can represent in its project-level config.
 *
 * Four of the six targets have no permission model at all and declare an empty set. An entry
 * whose action is absent here is blocked rather than downgraded — see `permissionStatus`
 * in ../utils.ts, which is the single place that rule is enforced.
 */
export type { PermissionAction };

export interface ExportOptions {
  /** Report what would happen without touching the filesystem. */
  dryRun?: boolean;
  /** Overwrite a conflicting existing file, after copying it to `<path>.bak`. */
  force?: boolean;
}

/**
 * What harnessport does with one feature for one harness.
 *
 * - `full`       — both imported and exported.
 * - `user-level` — the harness keeps it outside the repository, at a path under `~` that is
 *                  neither read nor written. The harness has the feature; harnessport does not
 *                  reach it. The fidelity item names that path.
 * - `none`       — not converted, because this harness has no equivalent concept.
 *
 * Deliberately not a measure of how *well* something converts. That question depends on the
 * config in hand, and the per-item fidelity report answers it precisely; a second, vaguer answer
 * in a static table would only contradict it.
 */
export type Capability = "full" | "user-level" | "none";

export interface Converter {
  /** CLI identifier, as passed to `--from` / `--to`. */
  name: string;
  /** Display name for the support matrix, e.g. "Claude Code" for `claude`. */
  label: string;
  /**
   * What this converter does with each feature. Documentation only: it drives `harnessport list`
   * and the README matrix, and is checked against the exporter's own fidelity items in
   * `tests/capabilities.test.ts` so it cannot quietly become aspirational.
   *
   * Never consult this to decide whether something may be written. Permission writes are gated by
   * `permissionActions` through `permissionStatus`, which is the single never-weaken enforcement
   * point and takes no converter.
   */
  capabilities: Record<Feature, Capability>;
  /** Permission actions this harness can express. Empty = no permission model. */
  permissionActions: ReadonlySet<PermissionAction>;
  /** Check if this harness's config files exist at the given root */
  detect(rootDir: string): boolean;
  /** Import config from this harness into canonical format */
  import(rootDir: string): HarnessConfig;
  /** Export canonical config to this harness's file format */
  export(
    rootDir: string,
    config: HarnessConfig,
    options?: ExportOptions,
  ): ExportResult;
}

export interface ExportResult {
  filesWritten: string[];
  items: FidelityItem[];
}

export const ALL_ACTIONS: ReadonlySet<PermissionAction> = new Set([
  "allow",
  "ask",
  "deny",
]);

export const NO_PERMISSIONS: ReadonlySet<PermissionAction> = new Set();

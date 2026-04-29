import type { HarnessConfig } from "../schema.js";

export interface Converter {
  name: string;
  /** Check if this harness's config files exist at the given root */
  detect(rootDir: string): boolean;
  /** Import config from this harness into canonical format */
  import(rootDir: string): HarnessConfig;
  /** Export canonical config to this harness's file format */
  export(rootDir: string, config: HarnessConfig, dryRun?: boolean): ExportResult;
}

export interface ExportResult {
  filesWritten: string[];
  warnings: string[];
}

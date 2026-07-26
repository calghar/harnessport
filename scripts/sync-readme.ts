// Regenerate README.md's support matrix from Converter.capabilities, or verify it is current.
//   npm run docs:matrix   rewrite the region
//   npm run docs:check    exit 1 if it is stale (runs as part of npm run check)

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { syncReadme } from "../src/matrix.js";

const readme = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "README.md",
);
const check = process.argv.includes("--check");
const outcome = syncReadme(readme, { check });

if (check && outcome.drifted) {
  console.error(outcome.message);
  process.exit(1);
}
console.log(
  outcome.drifted ? `Updated ${readme}` : `${readme} matrix is up to date`,
);

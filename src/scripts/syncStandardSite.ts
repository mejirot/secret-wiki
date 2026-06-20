import { pathToFileURL } from "node:url";
import { runStandardSiteSync } from "./standardSiteSync.js";

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runStandardSiteSync(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

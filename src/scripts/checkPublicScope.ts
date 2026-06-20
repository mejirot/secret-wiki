import { repoRoot } from "../shared/repoRoot.js";
import { createWikiStore } from "../wiki/store.js";

const store = createWikiStore({ rootDir: repoRoot });
const audit = await store.auditPublicScope();

if (audit.issues.length > 0) {
  console.error("Public scope check failed:");
  for (const issue of audit.issues) {
    console.error(`- ${issue.path}: ${issue.reason}`);
  }
  process.exit(1);
}

console.log("Public scope check passed.");

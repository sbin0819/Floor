import { closeDatabase } from "@/lib/dal";
import { getEnv } from "@/lib/env";
import { runSeed } from "@/lib/seed/run-seed";
import { runSeedCommand } from "./seed-command";
import { createFloorPlansReceiptStore } from "./floor-plans-receipt";

void runSeedCommand(process.argv.slice(2), {
  getEnvironment: getEnv,
  now: () => new Date(),
  runSeed,
  ...createFloorPlansReceiptStore(),
  closeDatabase,
  stdout: (message) => console.log(message),
  stderr: (message) => console.error(message),
}).then((exitCode) => {
  process.exitCode = exitCode;
});

import { createOperator } from "@/lib/auth/operators";
import { closeDatabase } from "@/lib/dal";
import { getEnv } from "@/lib/env";
import { runAdminCreate } from "./admin-create-command";

void runAdminCreate(process.argv.slice(2), {
  getEnvironment: getEnv,
  createOperator,
  closeDatabase,
  stdout: (message) => console.log(message),
  stderr: (message) => console.error(message),
}).then((exitCode) => {
  process.exitCode = exitCode;
});

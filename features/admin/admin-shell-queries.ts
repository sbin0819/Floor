import { cache } from "react";
import { createAdminShellQueries } from "./admin-shell-query-factory";

export const getAdminShell = cache((branchId: string) =>
  createAdminShellQueries().getAdminShell(branchId),
);

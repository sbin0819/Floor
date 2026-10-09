import { z } from "zod";
import { ActionError } from "@/lib/actions/result";
import { requireSession } from "@/lib/auth/session";
import { getOperatorBranches } from "@/lib/dal";
import { can } from "@/lib/permissions/can";
import { loadPermissionContext } from "@/lib/permissions/context";
import type { AdminQueryDependencies } from "./query-factory";
import type { AdminMenu, AdminShellData } from "./admin-shell-types";

export function createAdminShellQueries(
  dependencies: AdminQueryDependencies = {},
) {
  return {
    async getAdminShell(input: string): Promise<AdminShellData> {
      const session = await (dependencies.requireSession ?? requireSession)();
      const parsed = z.uuid().safeParse(input);
      if (!parsed.success) throw new ActionError("NOT_FOUND");
      const branchId = parsed.data.toLowerCase();
      const assigned = await getOperatorBranches(
        session.userId,
        dependencies.database,
      );
      if (!assigned.some((branch) => branch.id === branchId))
        throw new ActionError("NOT_FOUND");
      const context = await loadPermissionContext(
        session,
        assigned.map((branch) => branch.id),
        dependencies.database,
      );
      if (!context.staffBranchIds.includes(branchId))
        throw new ActionError("NOT_FOUND");
      return {
        branchId,
        branches: assigned
          .filter((branch) => context.staffBranchIds.includes(branch.id))
          .map((branch) => {
            const target = { branchId: branch.id };
            const menus: AdminMenu[] = [];
            if (can(context, "stats.view", target)) menus.push("dashboard");
            if (can(context, "booking.manage_all", target))
              menus.push("bookings");
            if (
              can(context, "space.manage", target) ||
              can(context, "plan.edit", target)
            )
              menus.push("spaces");
            return { id: branch.id, name: branch.name, menus };
          }),
        user: { name: session.name },
      };
    },
  };
}

import { z } from "zod";
import { ActionError } from "@/lib/actions/result";
import { requireSession } from "@/lib/auth/session";
import { getMemberships, getOperatorBranches } from "@/lib/dal";
import {
  getOperatorRoleSettings,
  getOngoingMaintenanceCounts,
} from "@/lib/dal/admin-shell";
import { can } from "@/lib/permissions/can";
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
      const [assigned, memberships, roleSettings] = await Promise.all([
        getOperatorBranches(session.userId, dependencies.database),
        getMemberships(session.userId, dependencies.database),
        getOperatorRoleSettings(session.userId, dependencies.database),
      ]);
      if (!assigned.some((branch) => branch.id === branchId))
        throw new ActionError("NOT_FOUND");
      const context = { userId: session.userId, ...memberships, roleSettings };
      if (!context.staffBranchIds.includes(branchId))
        throw new ActionError("NOT_FOUND");
      const maintenanceBranchIds = assigned
        .filter(
          (branch) =>
            context.staffBranchIds.includes(branch.id) &&
            can(context, "space.manage", { branchId: branch.id }),
        )
        .map((branch) => branch.id);
      const counts = await getOngoingMaintenanceCounts(
        maintenanceBranchIds,
        dependencies.now?.() ?? new Date(),
        dependencies.database,
      );
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
            if (can(context, "space.manage", target)) menus.push("maintenance");
            if (can(context, "roles.manage", target)) menus.push("roles");
            if (can(context, "plan.edit", target)) menus.push("plans");
            return {
              id: branch.id,
              name: branch.name,
              menus,
              ...(menus.includes("maintenance")
                ? { maintenanceCount: counts.get(branch.id) ?? 0 }
                : {}),
            };
          }),
        user: { name: session.name },
      };
    },
  };
}

import { ActionError } from "@/lib/actions/result";
import { requireSession } from "@/lib/auth/session";
import { getOperatorBranches } from "@/lib/dal";
import { createAdminQueries } from "./query-factory";
import { createRoleSettingsQueries } from "./role-settings-query-factory";

export async function getRoleSettingsEditor(branchId: string) {
  return createRoleSettingsQueries().getRoleSettingsEditor(branchId);
}
import { createMaintenanceQueries } from "./maintenance-query-factory";
import type {
  MaintenanceListInput,
  PreviewMaintenanceInput,
} from "./maintenance-schema";

export async function getMaintenanceList(input: MaintenanceListInput) {
  return createMaintenanceQueries().getMaintenanceList(input);
}
export async function previewMaintenance(input: PreviewMaintenanceInput) {
  return createMaintenanceQueries().previewMaintenance(input);
}
import {
  createAdminDashboardQueries,
  type AdminDashboardInput,
} from "./dashboard-query-factory";
import {
  createAdminBookingQueries,
  type AdminBookingsInput,
} from "./booking-query-factory";

export async function getAdminDashboard(input: AdminDashboardInput) {
  return createAdminDashboardQueries().getAdminDashboard(input);
}

export async function getAdminBookings(input: AdminBookingsInput) {
  return createAdminBookingQueries().getAdminBookings(input);
}
export async function getAdminBranch(branchId: string) {
  return createAdminQueries().getAdminBranch(branchId);
}
export async function getOperatorBranchCards() {
  return createAdminQueries().getOperatorBranchCards();
}
export async function getAdminFloor(
  branchId: string,
  floorId: string,
  teamQuery?: unknown,
) {
  return createAdminQueries().getAdminFloor(branchId, floorId, teamQuery);
}

export async function getOperatorHome() {
  const session = await requireSession();
  const branches = await getOperatorBranches(session.userId);
  if (branches.length === 0) throw new ActionError("FORBIDDEN");
  return { session, branches };
}

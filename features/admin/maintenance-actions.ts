"use server";

import { createMaintenanceActionFactory } from "./maintenance-action-factory";

export async function createMaintenance(input: unknown) {
  return createMaintenanceActionFactory().createMaintenance(input);
}
export async function updateMaintenance(input: unknown) {
  return createMaintenanceActionFactory().updateMaintenance(input);
}
export async function endMaintenance(input: unknown) {
  return createMaintenanceActionFactory().endMaintenance(input);
}
export async function deleteMaintenance(input: unknown) {
  return createMaintenanceActionFactory().deleteMaintenance(input);
}

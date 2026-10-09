"use server";

import { createRoleSettingsActions } from "./role-settings-action-factory";

export async function updateRoleSettings(input: unknown) {
  return createRoleSettingsActions().updateRoleSettings(input);
}

export async function resetRoleSettings(input: unknown) {
  return createRoleSettingsActions().resetRoleSettings(input);
}

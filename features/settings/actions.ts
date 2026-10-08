"use server";

import { createSettingsActions } from "./action-factory";

export async function updateName(input: unknown) {
  return createSettingsActions().updateName(input);
}
export async function updateAvatar(input: unknown) {
  return createSettingsActions().updateAvatar(input);
}
export async function changePassword(input: unknown) {
  return createSettingsActions().changePassword(input);
}
export async function revokeSession(input: unknown) {
  return createSettingsActions().revokeSession(input);
}
export async function revokeOtherSessions(input: unknown) {
  return createSettingsActions().revokeOtherSessions(input);
}
export async function updatePreferences(input: unknown) {
  return createSettingsActions().updatePreferences(input);
}

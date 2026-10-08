import { createSettingsQueries } from "./query-factory";

export async function getProfileSettings() {
  return createSettingsQueries().getProfileSettings();
}
export async function getAccountSettings() {
  return createSettingsQueries().getAccountSettings();
}
export async function getPreferences() {
  return createSettingsQueries().getPreferences();
}

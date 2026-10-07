"use server";

import { createAdminActions } from "./manage-factory";

export async function updateBranch(input: unknown) {
  return createAdminActions().updateBranch(input);
}
export async function createFloor(input: unknown) {
  return createAdminActions().createFloor(input);
}
export async function updateFloor(input: unknown) {
  return createAdminActions().updateFloor(input);
}
export async function createSpace(input: unknown) {
  return createAdminActions().createSpace(input);
}
export async function updateSpace(input: unknown) {
  return createAdminActions().updateSpace(input);
}
export async function archiveSpace(input: unknown) {
  return createAdminActions().archiveSpace(input);
}
export async function restoreSpace(input: unknown) {
  return createAdminActions().restoreSpace(input);
}

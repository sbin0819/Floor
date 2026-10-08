"use server";

import { createSpaceActions } from "./space-action-factory";

export async function joinLounge(input: unknown) {
  return createSpaceActions().joinLounge(input);
}
export async function createCommunitySpace(input: unknown) {
  return createSpaceActions().createCommunitySpace(input);
}
export async function leaveSpace(input: unknown) {
  return createSpaceActions().leaveSpace(input);
}
export async function updateSpace(input: unknown) {
  return createSpaceActions().updateSpace(input);
}
export async function setSpaceAdmin(input: unknown) {
  return createSpaceActions().setSpaceAdmin(input);
}
export async function transferSpaceOwnership(input: unknown) {
  return createSpaceActions().transferSpaceOwnership(input);
}
export async function deleteSpace(input: unknown) {
  return createSpaceActions().deleteSpace(input);
}

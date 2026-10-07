"use server";

import { createAccessActions } from "./access-factory";

export async function setFloorAccess(input: unknown) {
  return createAccessActions().setFloorAccess(input);
}
export async function setSpaceAccess(input: unknown) {
  return createAccessActions().setSpaceAccess(input);
}

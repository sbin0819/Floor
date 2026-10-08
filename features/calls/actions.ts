"use server";

import { createCallActions } from "./action-factory";

export async function joinCall(input: unknown) {
  return createCallActions().joinCall(input);
}
export async function declineCall(input: unknown) {
  return createCallActions().declineCall(input);
}

"use server";

import { createHomeActions } from "./action-factory";

export async function dismissHomeChecklist(input: unknown = {}) {
  return createHomeActions().dismissHomeChecklist(input);
}

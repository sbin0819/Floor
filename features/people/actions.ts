"use server";

import { createUsernameAction } from "./username";

export async function setUsername(input: unknown) {
  return createUsernameAction()(input);
}

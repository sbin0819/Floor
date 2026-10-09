"use server";

import { createAnnouncementActionFactory } from "./announcement-action-factory";

export async function sendAnnouncement(input: unknown) {
  return createAnnouncementActionFactory().sendAnnouncement(input);
}

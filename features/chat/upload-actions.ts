"use server";

import { createChatUploads } from "./uploads";

export async function createUploads(input: unknown) {
  return createChatUploads().createUploads(input);
}
export async function completeUploads(input: unknown) {
  return createChatUploads().completeUploads(input);
}
export async function discardUploads(input: unknown) {
  return createChatUploads().discardUploads(input);
}

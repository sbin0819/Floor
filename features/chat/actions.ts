"use server";

import { createChatActions } from "./action-factory";

export async function sendMessage(input: unknown) {
  return createChatActions().sendMessage(input);
}

export async function sendMessageRequest(input: unknown) {
  return createChatActions().sendMessageRequest(input);
}

export async function respondMessageRequest(input: unknown) {
  return createChatActions().respondMessageRequest(input);
}

export async function createGroupDm(input: unknown) {
  return createChatActions().createGroupDm(input);
}

export async function addGroupMembers(input: unknown) {
  return createChatActions().addGroupMembers(input);
}

export async function leaveGroupDm(input: unknown) {
  return createChatActions().leaveGroupDm(input);
}

export async function renameGroupDm(input: unknown) {
  return createChatActions().renameGroupDm(input);
}

export async function openDirectMessage(input: unknown) {
  return createChatActions().openDirectMessage(input);
}

export async function markRoomRead(input: unknown) {
  return createChatActions().markRoomRead(input);
}

export async function editMessage(input: unknown) {
  return createChatActions().editMessage(input);
}

export async function deleteMessage(input: unknown) {
  return createChatActions().deleteMessage(input);
}

export async function setReaction(input: unknown) {
  return createChatActions().setReaction(input);
}

export async function setRoomMuted(input: unknown) {
  return createChatActions().setRoomMuted(input);
}

export async function setSpaceMuted(input: unknown) {
  return createChatActions().setSpaceMuted(input);
}

import type { ActionResult } from "@/lib/actions/result";

const readOnlyAction: (
  input: unknown,
) => Promise<ActionResult<never>> = async () => ({
  ok: false,
  code: "FORBIDDEN",
});

export const createBooking = readOnlyAction;
export const joinLounge = readOnlyAction;
export const createCommunitySpace = readOnlyAction;
export const leaveSpace = readOnlyAction;
export const setSpaceAdmin = readOnlyAction;
export const transferSpaceOwnership = readOnlyAction;
export const deleteSpace = readOnlyAction;
export const createChannel = readOnlyAction;
export const updateChannel = readOnlyAction;
export const archiveChannel = readOnlyAction;
export const banSpaceMember = readOnlyAction;
export const unbanSpaceMember = readOnlyAction;
export const createInviteLink = readOnlyAction;
export const revokeInvite = readOnlyAction;
export const inviteToSpace = readOnlyAction;
export const joinSpaceByInvite = readOnlyAction;
export const sendMessage = readOnlyAction;
export const editMessage = readOnlyAction;
export const deleteMessage = readOnlyAction;
export const setReaction = readOnlyAction;
export const setRoomMuted = readOnlyAction;
export const setSpaceMuted = readOnlyAction;
export const openDirectMessage = readOnlyAction;
export const sendMessageRequest = readOnlyAction;
export const respondMessageRequest = readOnlyAction;
export const createGroupDm = readOnlyAction;
export const addGroupMembers = readOnlyAction;
export const leaveGroupDm = readOnlyAction;
export const renameGroupDm = readOnlyAction;
export const blockUser = readOnlyAction;
export const unblockUser = readOnlyAction;
export const reportUser = readOnlyAction;
export const reportMessage = readOnlyAction;
export const setUsername = readOnlyAction;
export const setStatus = readOnlyAction;
export const sendFriendRequest = readOnlyAction;
export const respondFriendRequest = readOnlyAction;
export const cancelFriendRequest = readOnlyAction;
export const removeFriend = readOnlyAction;
export const markRoomRead = async (input: { seq: number }) => ({
  ok: true as const,
  data: { lastReadSeq: input.seq },
});
export const updateBooking = readOnlyAction;
export const createDeskBooking = readOnlyAction;
export const cancelBooking = readOnlyAction;
export const leaveBooking = readOnlyAction;
export const setDefaultBranch = readOnlyAction;
export const markNotificationRead = readOnlyAction;
export const markAllNotificationsRead = () => readOnlyAction(undefined);

export const updateBranch = readOnlyAction;
export const createFloor = readOnlyAction;
export const updateFloor = readOnlyAction;
export const createSpace = readOnlyAction;
export const updateSpace = readOnlyAction;
export const archiveSpace = readOnlyAction;
export const restoreSpace = readOnlyAction;
export const setFloorAccess = readOnlyAction;
export const setSpaceAccess = readOnlyAction;

export const createTeam = readOnlyAction;
export const requestTeamJoin = readOnlyAction;
export const cancelTeamJoinRequest = readOnlyAction;
export const approveTeamJoinRequest = readOnlyAction;
export const rejectTeamJoinRequest = readOnlyAction;
export const sendTeamInvite = readOnlyAction;
export const revokeTeamInvite = readOnlyAction;
export const acceptTeamInvite = readOnlyAction;
export const declineTeamInvite = readOnlyAction;

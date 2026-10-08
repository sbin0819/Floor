import type { ActionResult } from "@/lib/actions/result";

const readOnlyAction: (
  input: unknown,
) => Promise<ActionResult<never>> = async () => ({
  ok: false,
  code: "FORBIDDEN",
});

export const createBooking = readOnlyAction;
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

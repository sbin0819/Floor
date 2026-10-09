import { myBookingsCalendarHref } from "@/features/bookings/calendar";
import {
  formatBookingDate,
  formatBookingTime,
} from "@/features/bookings/format";
import { addDays, localDate } from "@/lib/time/zoned";
import type { NotificationContent, NotificationSnapshot } from "./types";
export type NotificationTextPart = { text: string; strong: boolean };

const actionText = {
  booking_invited: " 예약에 초대했어요",
  booking_changed: " 예약의 시간을 바꿨어요",
  booking_cancelled: " 예약을 취소했어요",
  booking_removed: " 예약의 참석자에서 뺐어요",
  participant_left: " 예약에 참석하지 않아요",
} as const;

function notificationDate(start: string, timezone: string) {
  const date = localDate(new Date(start), timezone);
  return formatBookingDate(date, timezone).replace(/요일$/, "");
}

export function notificationHref({
  type,
  data,
  bookingId,
}: NotificationContent) {
  if (type === "friend_request") return "/friends?tab=received";
  if (type === "friend_accepted") return "/friends";
  if (type === "message_request") return "/friends?tab=requests";
  if (type === "space_invite") return `/s/join/${data.inviteCode}`;
  if (type === "team_removed" || type === "team_deleted") return "/teams";
  if (type === "team_role_changed") return `/teams/${data.teamId}`;
  if (type === "booking_removed") return null;
  if (type === "booking_cancelled") return "/bookings?tab=past";
  if (type === "booking_reminder") return bookingId ? `/m/${bookingId}` : null;
  const date = localDate(new Date(data.start), data.timezone);
  return myBookingsCalendarHref(date.slice(0, 7), date);
}

export function notificationPresentation({ type, data }: NotificationSnapshot) {
  if (
    type === "team_removed" ||
    type === "team_role_changed" ||
    type === "team_deleted"
  ) {
    const parts = [
      { text: data.actorName, strong: true },
      {
        text: type === "team_deleted" ? " 님이 ‘" : " 님이 나를 ",
        strong: false,
      },
      { text: data.teamName, strong: true },
      {
        text:
          type === "team_removed"
            ? "에서 내보냈어요"
            : type === "team_deleted"
              ? "’을(를) 지웠어요"
              : data.role === "admin"
                ? "의 팀 관리자로 지정했어요"
                : "의 팀원으로 바꿨어요",
        strong: false,
      },
    ];
    return {
      parts,
      text: parts.map((part) => part.text).join(""),
      dateTime: undefined,
    };
  }
  if (type === "space_invite") {
    const parts = [
      { text: data.actorName, strong: true },
      { text: " 님이 ", strong: false },
      { text: data.spaceName, strong: true },
      { text: " 스페이스에 초대했어요", strong: false },
    ];
    return {
      parts,
      text: parts.map((part) => part.text).join(""),
      dateTime: undefined,
    };
  }
  if (
    type === "friend_request" ||
    type === "friend_accepted" ||
    type === "message_request"
  ) {
    const parts = [
      { text: data.actorName, strong: true },
      {
        text:
          type === "friend_request"
            ? " 님이 친구 요청을 보냈어요"
            : type === "message_request"
              ? " 님이 메시지를 보내고 싶어 해요"
              : " 님이 친구 요청을 수락했어요",
        strong: false,
      },
    ];
    return {
      parts,
      text: parts.map((part) => part.text).join(""),
      dateTime: undefined,
    };
  }
  const parts: NotificationTextPart[] =
    type === "booking_reminder"
      ? [
          ...(data.minutesBefore
            ? [{ text: `${data.minutesBefore}분 뒤 `, strong: false }]
            : []),
          { text: data.spaceName, strong: true },
          {
            text: data.minutesBefore
              ? " 예약이 시작돼요"
              : " 예약이 시작됐어요",
            strong: false,
          },
        ]
      : type === "booking_cancelled" && data.cancelKind
        ? [
            {
              text: data.cancelKind === "operator" ? "운영자가 " : "점검으로 ",
              strong: false,
            },
            { text: data.spaceName, strong: true },
            {
              text:
                data.cancelKind === "operator"
                  ? " 예약을 취소했어요"
                  : " 예약이 취소됐어요",
              strong: false,
            },
          ]
        : [
            { text: data.actorName ?? "회원", strong: true },
            { text: " 님이 ", strong: false },
            { text: data.spaceName, strong: true },
            { text: actionText[type], strong: false },
          ];
  const time = formatBookingTime(data.start, data.end, data.timezone);
  let dateTime = `${notificationDate(data.start, data.timezone)} ${time}`;
  if (type === "booking_cancelled" && data.cancelReason) {
    dateTime = `${data.cancelKind === "operator" ? "이유: " : ""}${data.cancelReason} · ${dateTime}`;
  }
  if (type === "booking_changed" && data.previousStart && data.previousEnd) {
    const previousDate = localDate(new Date(data.previousStart), data.timezone);
    const date = localDate(new Date(data.start), data.timezone);
    const previous = `${notificationDate(data.previousStart, data.timezone)} ${formatBookingTime(data.previousStart, data.previousEnd, data.timezone)}`;
    dateTime = `${previous} → ${previousDate === date ? time : dateTime}`;
  }
  return {
    parts,
    text: parts.map((part) => part.text).join(""),
    dateTime,
  };
}

export function notificationAge(
  scheduledFor: string,
  now: string,
  timezone: string,
): string {
  const received = Date.parse(scheduledFor);
  const current = Date.parse(now);
  if (![received, current].every(Number.isFinite))
    throw new RangeError("Invalid notification timestamp.");
  const elapsed = Math.max(0, current - received);
  if (elapsed < 60_000) return "방금";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}분 전`;
  const today = localDate(new Date(current), timezone);
  const date = localDate(new Date(received), timezone);
  if (date === today) return `${Math.floor(elapsed / 3_600_000)}시간 전`;
  if (date === addDays(today, -1)) return "어제";
  for (let days = 2; days < 7; days += 1) {
    if (date === addDays(today, -days)) return `${days}일 전`;
  }
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: timezone,
    month: "long",
    day: "numeric",
  }).format(new Date(received));
}

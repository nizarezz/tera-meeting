import { prisma } from "../../config/database";
import { ValidationError } from "../../common/errors/app-error";
import { buildMeetingVisibilityFilter } from "../../policies/meeting-visibility";
import type { CalendarDayResponse, CalendarMeetingCard } from "../meetings/meetings.service";

function utcOffsetMsAtDate(timezone: string, date: Date): number {
  const formatter = new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    hour12: false,
    year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", second: "numeric",
  });
  const parts = formatter.formatToParts(date);
  const p = (type: string) => parseInt(parts.find((x) => x.type === type)?.value ?? "0", 10);
  const localEpoch = Date.UTC(p("year"), p("month") - 1, p("day"), p("hour"), p("minute"), p("second"));
  return localEpoch - date.getTime();
}

function localDateToUTCRange(timezone: string, dateStr: string): { start: Date; end: Date } {
  const [y, m, d] = dateStr.split("-").map(Number);
  const noonUtc = new Date(Date.UTC(y, m - 1, d, 12, 0, 0, 0));
  const offsetMs = utcOffsetMsAtDate(timezone, noonUtc);
  const dayStart = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0) - offsetMs);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { start: dayStart, end: dayEnd };
}

function computeEndsAt(m: any): Date {
  if (m.status === "COMPLETED_LOCKED" && m.lockedAt) return m.lockedAt;
  if (m.status === "ENDED_PENDING_SUMMARY" && m.endedAt) return m.endedAt;
  if (m.scheduledAt) return new Date(m.scheduledAt.getTime() + (m.actualDurationSeconds ?? m.plannedDurationSeconds) * 1000);
  return m.scheduledAt;
}

export async function getDayCalendar(userId: string, dateStr: string): Promise<CalendarDayResponse> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { organizationId: true, operationalRole: true },
  });

  const org = await prisma.organization.findUnique({
    where: { id: user?.organizationId ?? "" },
    select: { timezone: true },
  });
  const timezone = org?.timezone ?? "UTC";

  const { start: dayStart, end: dayEnd } = localDateToUTCRange(timezone, dateStr);

  const visibilityFilter = await buildMeetingVisibilityFilter(userId);

  const twoDaysMs = 2 * 24 * 60 * 60 * 1000;
  const candidates = await prisma.meeting.findMany({
    where: {
      ...visibilityFilter,
      status: { in: ["SCHEDULED", "IN_PROGRESS", "ENDED_PENDING_SUMMARY", "COMPLETED_LOCKED"] },
      scheduledAt: {
        gte: new Date(dayStart.getTime() - twoDaysMs),
        lt: new Date(dayEnd.getTime() + twoDaysMs),
      },
    },
    include: {
      attendees: { where: { removedAt: null }, select: { userId: true } },
      ownerTeam: { select: { id: true, name: true } },
      room: { select: { id: true, name: true } },
      organizer: { select: { id: true, name: true } },
    },
    orderBy: { scheduledAt: "asc" },
  });

  const overlapping = candidates.filter((m) => {
    if (!m.scheduledAt) return false;
    const endsAt = computeEndsAt(m);
    return endsAt.getTime() > dayStart.getTime() && m.scheduledAt.getTime() < dayEnd.getTime();
  });

  const isSecretary = user?.operationalRole === "SECRETARY";

  function toCalendarCard(m: any): CalendarMeetingCard {
    const isOrganizer = m.organizerId === userId;
    const isAttendee = m.attendees?.some((a: any) => a.userId === userId);
    const canOpenLiveRoom =
      (m.status === "IN_PROGRESS" && (isOrganizer || isSecretary || isAttendee)) ||
      (m.status === "SCHEDULED" && (isOrganizer || isSecretary) &&
        (!m.scheduledAt || m.scheduledAt.getTime() - Date.now() <= 3600_000));
    const canViewMeetingSummary = m.status === "ENDED_PENDING_SUMMARY" || m.status === "COMPLETED_LOCKED";

    const room = m.room ?? null;
    const locationType: string = m.locationType;
    if ((locationType === "PHYSICAL" || locationType === "HYBRID") && !room) {
      throw new ValidationError(`Meeting ${m.id} has locationType ${locationType} but no room`);
    }
    if (locationType === "ONLINE" && room) {
      throw new ValidationError(`Meeting ${m.id} has locationType ONLINE but has a room`);
    }

    return {
      id: m.id,
      title: m.title,
      status: m.status,
      kind: m.kind,
      scheduledAt: m.scheduledAt?.toISOString() ?? null,
      plannedDurationSeconds: m.plannedDurationSeconds,
      actualDurationSeconds: m.actualDurationSeconds ?? null,
      locationType,
      room,
      ownerTeam: m.ownerTeam ?? { id: m.ownerTeamId, name: m.ownerTeamId },
      organizer: m.organizer ?? { id: m.organizerId, name: m.organizerId },
      activeAttendeeCount: m.attendees?.length ?? 0,
      capabilities: { canOpenLiveRoom, canViewMeetingSummary },
      startsAt: m.scheduledAt.toISOString(),
      endsAt: computeEndsAt(m).toISOString(),
    };
  }

  return {
    date: dateStr,
    timezone,
    meetings: overlapping.map(toCalendarCard),
  };
}

const DAY_START = 8 * 60 + 30;
const LUNCH_START = 11 * 60 + 30;
const LUNCH_END = 13 * 60 + 30;
const DAY_END = 16 * 60 + 30;
const DEFAULT_DURATION = 90;

function toMinutes(h: number, m: number) { return h * 60 + m; }

export async function getWeeklyView(userId: string, weekStart: Date) {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const meetings = await prisma.meeting.findMany({
    where: {
      attendees: { some: { userId } },
      status: { in: ["SCHEDULED", "IN_PROGRESS", "DRAFT"] },
      scheduledAt: { gte: weekStart, lt: weekEnd },
    },
    include: {
      attendees: {
        where: { userId },
      },
      agendaItems: {
        where: { speakers: { some: { userId } } },
        select: { id: true },
      },
    },
    orderBy: { scheduledAt: "asc" },
  });

  const days: Record<string, any[]> = {};
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    days[d.toISOString().slice(0, 10)] = [];
  }

  for (const m of meetings) {
    if (!m.scheduledAt) {
      days["unscheduled"] = days["unscheduled"] || [];
      days["unscheduled"].push(formatMeetingRow(m, userId));
      continue;
    }
    const dayKey = m.scheduledAt.toISOString().slice(0, 10);
    if (days[dayKey]) {
      days[dayKey].push(formatMeetingRow(m, userId));
    }
  }

  return days;
}

function formatMeetingRow(meeting: any, userId: string) {
  const myItems = meeting.agendaItems ?? [];

  return {
    id: meeting.id,
    title: meeting.title,
    time: meeting.scheduledAt,
    duration: meeting.plannedDurationSeconds,
    status: meeting.status,
    youSpeak: myItems.length > 0,
  };
}

function generateStartSlots(dayStart: number, dayEnd: number, duration: number) {
  const slots: number[] = [];
  for (let t = dayStart; t + duration <= dayEnd; t += 30) {
    const slotEnd = t + duration;
    const overlapsLunch = t < LUNCH_END && slotEnd > LUNCH_START;
    if (!overlapsLunch) {
      slots.push(t);
    }
  }
  return slots;
}

function formatTime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${m.toString().padStart(2, "0")}`;
}

export async function getAvailableSlots(
  organizationId: string,
  dateStr: string,
  duration: number = DEFAULT_DURATION,
  requiredUserIds?: string[]
) {
  const date = new Date(dateStr + "T00:00:00");
  const slotDuration = duration;

  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(23, 59, 59, 999);

  const teamMeetings = await prisma.meeting.findMany({
    where: {
      organizationId,
      status: { in: ["SCHEDULED", "IN_PROGRESS"] },
      scheduledAt: { gte: dayStart, lte: dayEnd },
    },
    include: {
      attendees: { select: { userId: true } },
    },
  });

  const rooms = await prisma.room.findMany({
    where: { organizationId, isActive: true },
  });

  const slotTimes = generateStartSlots(DAY_START, DAY_END, slotDuration);
  const slots = slotTimes.map((startMin) => {
    const slotStart = new Date(date);
    slotStart.setHours(0, startMin, 0, 0);
    const slotEnd = new Date(slotStart.getTime() + slotDuration * 60 * 1000);

    const timeLabel = formatTime(startMin);
    const endLabel = formatTime(startMin + slotDuration);

    let personConflict = false;
    if (requiredUserIds && requiredUserIds.length > 0) {
      for (const mtg of teamMeetings) {
        if (!mtg.scheduledAt) continue;
        const mStart = mtg.scheduledAt.getTime();
        const mEnd = mStart + (mtg.plannedDurationSeconds * 1000);

        if (slotStart.getTime() < mEnd && slotEnd.getTime() > mStart) {
          const attendeeIds = mtg.attendees.map((a) => a.userId);
          const overlap = requiredUserIds.some((uid) => attendeeIds.includes(uid));
          if (overlap) {
            personConflict = true;
            break;
          }
        }
      }
    }

    const conflictingRoomIds = rooms
      .filter((room) => {
        return teamMeetings.some((mtg) => {
          if (!mtg.scheduledAt || mtg.roomId !== room.id) return false;
          const mStart = mtg.scheduledAt.getTime();
          const mEnd = mStart + (mtg.plannedDurationSeconds * 1000);
          return slotStart.getTime() < mEnd && slotEnd.getTime() > mStart;
        });
      })
      .map((r) => r.id);

    const available = !personConflict && conflictingRoomIds.length < rooms.length;

    return {
      time: timeLabel,
      endTime: endLabel,
      startMinutes: startMin,
      available,
      personConflict,
      roomConflict: conflictingRoomIds.length > 0,
      conflictingRoomIds: conflictingRoomIds.length > 0 ? conflictingRoomIds : undefined,
    };
  });

  return {
    date: dateStr,
    duration: slotDuration,
    slots,
  };
}

export async function getDraftsNeedingNudge() {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  return prisma.meeting.findMany({
    where: {
      status: "DRAFT",
      createdAt: { lt: sevenDaysAgo },
    },
    include: {
      attendees: { include: { user: true } },
      creator: true,
    },
    orderBy: { createdAt: "asc" },
  });
}

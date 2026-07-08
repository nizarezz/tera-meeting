import { prisma } from "../../config/database";
import { NotFoundError, ValidationError, ForbiddenError } from "../../common/errors/app-error";
import type { MeetingStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { notifyMeetingUpdate } from "../../sockets/meeting.socket";
import { logAuditEvent } from "../../services/audit.service";
import { buildMeetingVisibilityFilter } from "../../policies/meeting-visibility";

export interface CursorPayload {
  version: 1;
  sort: "UPCOMING" | "RECENT" | "TITLE";
  id: string;
  scheduledAt?: string | null;
  lockedAt?: string | null;
  title?: string;
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

export function decodeCursor(encoded: string, expectedSort: string): CursorPayload {
  let parsed: any;
  try {
    const json = Buffer.from(encoded, "base64url").toString("utf-8");
    parsed = JSON.parse(json);
  } catch {
    throw new ValidationError("Invalid cursor format", "INVALID_CURSOR");
  }
  if (parsed.version !== 1) {
    throw new ValidationError("Unsupported cursor version", "INVALID_CURSOR_VERSION");
  }
  if (parsed.sort !== expectedSort) {
    throw new ValidationError("Cursor sort mode does not match query sort", "CURSOR_SORT_MISMATCH");
  }
  if (!parsed.id || typeof parsed.id !== "string") {
    throw new ValidationError("Cursor missing id", "INVALID_CURSOR");
  }
  return parsed as CursorPayload;
}

export interface BrowseParams {
  cursor?: string;
  limit?: number;
  search?: string;
  statuses?: string;
  kinds?: string;
  ownerTeamId?: string;
  from?: string;
  to?: string;
  sort?: "UPCOMING" | "RECENT" | "TITLE";
}

export interface MeetingBrowseCard {
  id: string;
  title: string;
  status: string;
  kind: string;
  scheduledAt: string | null;
  plannedDurationSeconds: number;
  actualDurationSeconds: number | null;
  locationType: string;
  room: { id: string; name: string } | null;
  ownerTeam: { id: string; name: string };
  organizer: { id: string; name: string };
  activeAttendeeCount: number;
  capabilities: {
    canOpenLiveRoom: boolean;
    canViewMeetingSummary: boolean;
  };
}

export interface MeetingBrowseResponse {
  timezone: string;
  items: MeetingBrowseCard[];
  nextCursor: string | null;
  totalVisible: number;
  filterOptions: {
    teams: Array<{ id: string; name: string }>;
  };
}

export interface CalendarMeetingCard extends MeetingBrowseCard {
  startsAt: string;
  endsAt: string;
}

export interface CalendarDayResponse {
  date: string;
  timezone: string;
  meetings: CalendarMeetingCard[];
}

const TRANSITIONS: Record<MeetingStatus, MeetingStatus[]> = {
  DRAFT: ["SCHEDULED", "CANCELLED"],
  SCHEDULED: ["DRAFT", "IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["ENDED_PENDING_SUMMARY"],
  ENDED_PENDING_SUMMARY: ["COMPLETED_LOCKED"],
  COMPLETED_LOCKED: [],
  // Completed/Archived removed — use COMPLETED_LOCKED only
  CANCELLED: [],
};

function assertTransition(from: MeetingStatus, to: MeetingStatus) {
  const allowed = TRANSITIONS[from];
  if (!allowed?.includes(to)) {
    throw new ValidationError(
      `Cannot transition meeting from '${from}' to '${to}'. Allowed: [${(allowed ?? []).join(", ") || "none"}]`
    );
  }
}

async function requireOrganizer(meetingId: string, userId: string) {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: { organizerId: true },
  });
  if (!meeting) throw new NotFoundError("Meeting");
  if (meeting.organizerId !== userId) {
    throw new ForbiddenError("Only the meeting organizer can perform this action");
  }
}

async function assertNotLocked(meetingId: string) {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: { status: true },
  });
  if (!meeting) throw new NotFoundError("Meeting");
  if (meeting.status === "COMPLETED_LOCKED") {
    throw new ValidationError("Meeting is locked and cannot be modified");
  }
}

const meetingInclude = {
  attendees: { include: { user: true } },
  agendaItems: {
    orderBy: { sortOrder: "asc" as const },
    include: { speakers: { include: { user: { select: { id: true, name: true } } } } },
  },
  timer: true,
  bookings: true,
  creator: { select: { id: true, name: true, email: true } },
  organizer: { select: { id: true, name: true, email: true } },
  room: { select: { id: true, name: true } },
  ownerTeam: { select: { id: true, name: true } },
  executiveRequest: { select: { id: true, title: true, status: true } },
};

async function upsertRoomBooking(meetingId: string, roomId: string | null | undefined, scheduledAt: Date | null | undefined, durationSeconds: number) {
  await prisma.roomBooking.deleteMany({ where: { meetingId } });
  if (roomId && scheduledAt) {
    const endsAt = new Date(scheduledAt.getTime() + durationSeconds * 1000);
    await prisma.roomBooking.create({
      data: { meetingId, roomId, startsAt: scheduledAt, endsAt },
    });
  }
}

export async function listMeetings(userId: string, status?: string) {
  const where: any = {
    OR: [
      { attendees: { some: { userId, removedAt: null } } },
      { createdById: userId },
    ],
  };
  if (status) where.status = status;

  return prisma.meeting.findMany({
    where,
    include: {
      attendees: { include: { user: true } },
      agendaItems: { orderBy: { sortOrder: "asc" } },
      creator: true,
    },
    orderBy: { scheduledAt: "asc" },
  });
}

export async function browseMeetings(userId: string, params: BrowseParams): Promise<MeetingBrowseResponse> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { organizationId: true, operationalRole: true },
  });
  if (!user) {
    return { timezone: "UTC", items: [], nextCursor: null, totalVisible: 0, filterOptions: { teams: [] } };
  }

  const org = await prisma.organization.findUnique({
    where: { id: user.organizationId },
    select: { timezone: true },
  });
  const timezone = org?.timezone ?? "UTC";

  const visibilityFilter = await buildMeetingVisibilityFilter(userId);
  const where: any = { ...visibilityFilter };

  const statusList = params.statuses
    ? params.statuses.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  if (statusList.length > 0) where.status = { in: statusList };

  if (params.kinds) {
    const kindList = params.kinds.split(",").map((s) => s.trim()).filter(Boolean);
    if (kindList.length > 0) where.kind = { in: kindList };
  }

  if (params.ownerTeamId) where.ownerTeamId = params.ownerTeamId;

  if (params.from || params.to) {
    where.scheduledAt = {};
    if (params.from) where.scheduledAt.gte = new Date(params.from);
    if (params.to) where.scheduledAt.lte = new Date(params.to);
  }

  if (params.search) where.title = { contains: params.search, mode: "insensitive" };

  const sort = params.sort ?? "UPCOMING";
  let orderBy: any[];
  switch (sort) {
    case "RECENT":
      orderBy = [{ lockedAt: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }];
      break;
    case "TITLE":
      orderBy = [{ title: "asc" }, { id: "asc" }];
      break;
    case "UPCOMING":
    default:
      orderBy = [{ scheduledAt: { sort: "asc", nulls: "last" } }, { title: "asc" }];
      break;
  }

  const limit = params.limit ?? 20;

  let cursorFilter: any = undefined;
  if (params.cursor) {
    const cursor = decodeCursor(params.cursor, sort);
    switch (sort) {
      case "UPCOMING":
        if (cursor.scheduledAt !== null && cursor.scheduledAt !== undefined) {
          cursorFilter = {
            OR: [
              { scheduledAt: { gt: new Date(cursor.scheduledAt) } },
              { scheduledAt: new Date(cursor.scheduledAt), id: { gt: cursor.id } },
            ],
          };
        } else {
          cursorFilter = { scheduledAt: null, id: { gt: cursor.id } };
        }
        break;
      case "RECENT":
        if (cursor.lockedAt !== null && cursor.lockedAt !== undefined) {
          cursorFilter = {
            OR: [
              { lockedAt: { lt: new Date(cursor.lockedAt) } },
              { lockedAt: new Date(cursor.lockedAt), id: { gt: cursor.id } },
              { lockedAt: null },
            ],
          };
        } else {
          cursorFilter = { lockedAt: null, id: { gt: cursor.id } };
        }
        break;
      case "TITLE":
        cursorFilter = {
          OR: [
            { title: { gt: cursor.title } },
            { title: cursor.title, id: { gt: cursor.id } },
          ],
        };
        break;
    }
  }

  const finalWhere: any = cursorFilter ? { AND: [where, cursorFilter] } : where;

  const meetings = await prisma.meeting.findMany({
    where: finalWhere,
    orderBy,
    take: limit + 1,
    include: {
      attendees: { where: { removedAt: null }, select: { userId: true } },
      ownerTeam: { select: { id: true, name: true } },
      room: { select: { id: true, name: true } },
      organizer: { select: { id: true, name: true } },
    },
  });

  const hasMore = meetings.length > limit;
  const items = meetings.slice(0, limit);
  const lastItem = items[items.length - 1];
  const nextCursor = hasMore && lastItem ? encodeCursor({
    version: 1,
    sort,
    id: lastItem.id,
    scheduledAt: lastItem.scheduledAt?.toISOString() ?? null,
    lockedAt: lastItem.lockedAt?.toISOString() ?? null,
    title: lastItem.title,
  }) : null;

  const totalVisible = await prisma.meeting.count({
    where,
  });

  const teams = await prisma.functionalTeam.findMany({
    where: { organizationId: user.organizationId, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const isSecretary = user.operationalRole === "SECRETARY";

  function toCard(m: any): MeetingBrowseCard {
    const isOrganizer = m.organizerId === userId;
    const isAttendee = m.attendees?.some((a: any) => a.userId === userId);
    const canOpenLiveRoom =
      (m.status === "IN_PROGRESS" && (isOrganizer || isSecretary || isAttendee)) ||
      (m.status === "SCHEDULED" && (isOrganizer || isSecretary));
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
    };
  }

  return {
    timezone,
    items: items.map(toCard),
    nextCursor,
    totalVisible,
    filterOptions: { teams },
  };
}

export async function getMeetingById(id: string) {
  const meeting = await prisma.meeting.findUnique({
    where: { id },
    include: meetingInclude,
  });
  if (!meeting) throw new NotFoundError("Meeting");
  return meeting;
}

export async function getMeetingDetail(id: string, userId: string) {
  const meeting = await getMeetingById(id);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, operationalRole: true, isExecutive: true, functionalTeamId: true },
  });

  const isOrganizer = meeting.organizerId === userId;
  const isSecretary = user?.operationalRole === "SECRETARY";
  const isTeamAdminOfOwnerTeam = user?.operationalRole === "TEAM_ADMIN" && user?.functionalTeamId === meeting.ownerTeamId;

    const capabilities = {
    canOpenLiveRoom:
      (meeting.status === "IN_PROGRESS" && (isOrganizer || isSecretary ||
        meeting.attendees.some((a) => a.userId === userId && !a.removedAt) ||
        meeting.agendaItems.some((item) => item.speakers.some((s) => s.userId === userId)))) ||
      (meeting.status === "SCHEDULED" && (isOrganizer || isSecretary)),
    canManageAttendees:
      meeting.status === "SCHEDULED" &&
      meeting.kind === "QUICK_TEAM" &&
      (isOrganizer || isSecretary),
    canCancel:
      (meeting.status === "DRAFT" || meeting.status === "SCHEDULED") &&
      (isSecretary || (meeting.createdById === userId && isTeamAdminOfOwnerTeam)),
    canOverrideSchedule:
      isSecretary && meeting.kind === "STRUCTURED" && meeting.status === "SCHEDULED",
    canViewLinkedExecutiveRequest: !!(meeting.executiveRequest && (isOrganizer || isSecretary)),
    canViewAllNotes: isOrganizer || isSecretary,
    canViewMeetingSummary:
      meeting.status === "ENDED_PENDING_SUMMARY" || meeting.status === "COMPLETED_LOCKED",
  };

  return { ...meeting, capabilities };
}

export async function createMeeting(
  userId: string,
  data: {
    title: string;
    kind?: string;
    ownerTeamId: string;
    plannedDurationSeconds: number;
    organizationId: string;
    scheduledAt?: string | null;
    locationType?: "PHYSICAL" | "ONLINE" | "HYBRID";
    roomId?: string | null;
    onlineLink?: string | null;
    attendeeIds?: string[];
    agendaItems?: { title: string; durationSeconds?: number; speakerIds?: string[]; notes?: string | null; sortOrder?: number }[];
    parkingLotItemIds?: string[];
  }
) {
  const kind = data.kind === "STRUCTURED" ? "STRUCTURED" : "QUICK_TEAM";

  if (kind === "STRUCTURED") {
    if (!data.agendaItems || data.agendaItems.length === 0) {
      throw new ValidationError("Structured meetings require at least one agenda item");
    }
    const totalAgendaSeconds = data.agendaItems.reduce((sum, item) => sum + (item.durationSeconds ?? 0), 0);
    if (totalAgendaSeconds > data.plannedDurationSeconds) {
      throw new ValidationError(
        `Total agenda duration (${totalAgendaSeconds / 60}min) exceeds meeting duration (${data.plannedDurationSeconds / 60}min)`
      );
    }
  }

  const scheduledAt = data.scheduledAt ? new Date(data.scheduledAt) : null;
  const locationType = data.locationType;
  if (!locationType) throw new ValidationError("locationType is required");
  if (locationType === "PHYSICAL" && (!data.roomId || data.onlineLink != null)) {
    throw new ValidationError("Physical meetings require a room and no online link");
  }
  if (locationType === "ONLINE" && (!data.onlineLink || data.roomId != null)) {
    throw new ValidationError("Online meetings require an online link and no room");
  }
  if (locationType === "HYBRID" && (!data.roomId || !data.onlineLink)) {
    throw new ValidationError("Hybrid meetings require both a room and an online link");
  }

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const actor = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, organizationId: true, functionalTeamId: true, operationalRole: true, isExecutive: true, isActive: true },
    });
    if (!actor || !actor.isActive) throw new ForbiddenError("Active user profile required to create meetings");
    if (actor.operationalRole !== "SECRETARY" && actor.operationalRole !== "TEAM_ADMIN") {
      throw new ForbiddenError("Only secretaries and team admins can create meetings");
    }
    if (actor.organizationId !== data.organizationId) {
      throw new ForbiddenError("Cannot create a meeting for another organization");
    }

    const ownerTeam = await tx.functionalTeam.findUnique({
      where: { id: data.ownerTeamId },
      select: { id: true, organizationId: true, isActive: true },
    });
    if (!ownerTeam || !ownerTeam.isActive || ownerTeam.organizationId !== actor.organizationId) {
      throw new ValidationError("ownerTeamId must reference an active Team in your organization");
    }
    if (actor.operationalRole === "TEAM_ADMIN" && actor.functionalTeamId !== ownerTeam.id) {
      throw new ForbiddenError("Team admins can create meetings only for their own Team");
    }

    const suppliedAttendeeIds = [...new Set(data.attendeeIds ?? [])];
    if (suppliedAttendeeIds.length) {
      const attendees = await tx.user.findMany({
        where: { id: { in: suppliedAttendeeIds } },
        select: { id: true, functionalTeamId: true, organizationId: true, isActive: true },
      });
      const valid = attendees.length === suppliedAttendeeIds.length && attendees.every(
        (user) => user.isActive && user.organizationId === actor.organizationId && user.functionalTeamId === ownerTeam.id,
      );
      if (!valid) throw new ValidationError("All attendeeIds must be active users from the owner Team");
    }

    const speakerIds = [...new Set((data.agendaItems ?? []).flatMap((item) => item.speakerIds ?? []))];
    if (speakerIds.length) {
      const speakers = await tx.user.findMany({
        where: { id: { in: speakerIds } },
        select: { id: true, functionalTeamId: true, organizationId: true, isActive: true },
      });
      const valid = speakers.length === speakerIds.length && speakers.every(
        (user) => user.isActive && user.organizationId === actor.organizationId && user.functionalTeamId === ownerTeam.id,
      );
      if (!valid) throw new ValidationError("All speakerIds must be active users from the owner Team");
    }

    if (data.roomId) {
      const room = await tx.room.findUnique({
        where: { id: data.roomId },
        select: { id: true, organizationId: true, isActive: true },
      });
      if (!room || !room.isActive || room.organizationId !== actor.organizationId) {
        throw new ValidationError("roomId must reference an active Room in your organization");
      }
    }

    const parkingLotItemIds = [...new Set(data.parkingLotItemIds ?? [])];
    if (parkingLotItemIds.length) {
      const items = await tx.parkingLotItem.findMany({
        where: { id: { in: parkingLotItemIds } },
        select: { id: true, organizationId: true, teamId: true, status: true, agendaMeetingId: true },
      });
      const valid = items.length === parkingLotItemIds.length && items.every(
        (item) => item.organizationId === actor.organizationId && item.teamId === ownerTeam.id && item.status === "APPROVED" && !item.agendaMeetingId,
      );
      if (!valid) throw new ValidationError("Parking Lot items must be approved, unused, and owned by the owner Team");
    }

    if (scheduledAt && data.roomId && (locationType === "PHYSICAL" || locationType === "HYBRID")) {
      // Serialize booking decisions per room across all application instances.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${data.roomId}, 0))`;
      const endsAt = new Date(scheduledAt.getTime() + data.plannedDurationSeconds * 1000);
      const overlap = await tx.roomBooking.findFirst({
        where: { roomId: data.roomId, startsAt: { lt: endsAt }, endsAt: { gt: scheduledAt } },
        select: { id: true },
      });
      if (overlap) throw new ValidationError("Room is already booked during this time", "ROOM_CONFLICT");
    }

    const attendeeIds = [...new Set([...suppliedAttendeeIds, actor.id])];
    const meeting = await tx.meeting.create({
      data: {
        title: data.title,
        kind,
        ownerTeamId: ownerTeam.id,
        plannedDurationSeconds: data.plannedDurationSeconds,
        organizationId: actor.organizationId,
        scheduledAt,
        locationType,
        roomId: data.roomId,
        onlineLink: data.onlineLink,
        createdById: actor.id,
        organizerId: actor.id,
        status: scheduledAt ? "SCHEDULED" : "DRAFT",
        attendees: { create: attendeeIds.map((attendeeId) => ({ userId: attendeeId })) },
        agendaItems: data.agendaItems
          ? { create: data.agendaItems.map((item, i) => ({
              title: item.title,
              durationSeconds: item.durationSeconds ?? 0,
              notes: item.notes,
              sortOrder: item.sortOrder ?? i,
              speakers: item.speakerIds?.length
                ? { create: [...new Set(item.speakerIds)].map((speakerId) => ({ userId: speakerId })) }
                : undefined,
            })) }
          : undefined,
      },
      include: { attendees: { include: { user: true } }, agendaItems: { orderBy: { sortOrder: "asc" } } },
    });

    if (scheduledAt && data.roomId && (locationType === "PHYSICAL" || locationType === "HYBRID")) {
      await tx.roomBooking.create({
        data: {
          meetingId: meeting.id,
          roomId: data.roomId,
          startsAt: scheduledAt,
          endsAt: new Date(scheduledAt.getTime() + data.plannedDurationSeconds * 1000),
        },
      });
    }

    if (parkingLotItemIds.length) {
      const updated = await tx.parkingLotItem.updateMany({
        where: { id: { in: parkingLotItemIds }, status: "APPROVED", agendaMeetingId: null },
        data: { status: "USED_IN_AGENDA", agendaMeetingId: meeting.id },
      });
      if (updated.count !== parkingLotItemIds.length) {
        throw new ValidationError("Parking Lot items changed during meeting creation; please retry");
      }
    }

    return meeting;
  });
}

export async function createQuickMeeting(
  userId: string,
  data: Omit<Parameters<typeof createMeeting>[1], "kind">
) {
  return createMeeting(userId, { ...data, kind: "QUICK_TEAM" });
}

export async function createStructuredMeeting(
  userId: string,
  data: Omit<Parameters<typeof createMeeting>[1], "kind">
) {
  return createMeeting(userId, { ...data, kind: "STRUCTURED" });
}

export async function updateMeeting(
  id: string,
  userId: string,
  data: {
    title?: string;
    scheduledAt?: string;
    roomId?: string | null;
    plannedDurationSeconds?: number;
    agendaItems?: { title: string; durationSeconds?: number; speakerIds?: string[]; notes?: string | null }[];
  }
) {
  await assertNotLocked(id);
  const meeting = await prisma.meeting.findUnique({ where: { id } });
  if (!meeting) throw new NotFoundError("Meeting");

  if (meeting.status === "IN_PROGRESS") {
    throw new ValidationError("Cannot edit a meeting while it is in progress");
  }
  if (meeting.status === "ENDED_PENDING_SUMMARY") {
    throw new ValidationError("Meeting has ended pending summary and cannot be edited");
  }
  if (meeting.status === "CANCELLED") {
    throw new ValidationError("Cannot edit a cancelled meeting");
  }
  if (meeting.status === "SCHEDULED" && meeting.kind === "STRUCTURED") {
    throw new ValidationError("Cannot edit a scheduled structured meeting; use focused mutation endpoints");
  }

  const actor = await prisma.user.findUnique({
    where: { id: userId },
    select: { operationalRole: true, functionalTeamId: true, organizationId: true },
  });
  if (!actor) throw new NotFoundError("Actor");
  const isSec = actor.operationalRole === "SECRETARY";
  const isOrg = meeting.organizerId === userId;
  const isTeamAdminOfOwner = actor.operationalRole === "TEAM_ADMIN" && actor.functionalTeamId === meeting.ownerTeamId;
  if (!isSec && !isOrg && !isTeamAdminOfOwner) {
    throw new ForbiddenError("Only the organizer, a secretary, or the owner team admin can update this meeting");
  }

  const updateData: any = {};
  if (data.title) updateData.title = data.title;
  if (data.plannedDurationSeconds) updateData.plannedDurationSeconds = data.plannedDurationSeconds;
  if (data.scheduledAt !== undefined) updateData.scheduledAt = data.scheduledAt ? new Date(data.scheduledAt) : null;
  if (data.roomId !== undefined) updateData.roomId = data.roomId;

  const newRoomId = data.roomId !== undefined ? data.roomId : meeting.roomId;
  const newScheduledAt = data.scheduledAt !== undefined ? (data.scheduledAt ? new Date(data.scheduledAt) : null) : meeting.scheduledAt;
  const newDuration = data.plannedDurationSeconds || meeting.plannedDurationSeconds;
  const roomChanged = data.roomId !== undefined && data.roomId !== meeting.roomId;
  const timeChanged = data.scheduledAt !== undefined;
  if ((roomChanged || timeChanged) && newRoomId && newScheduledAt && (meeting.locationType === "PHYSICAL" || meeting.locationType === "HYBRID")) {
    await prisma.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${newRoomId}, 0))`;
    const endsAt = new Date(newScheduledAt.getTime() + newDuration * 1000);
    const overlap = await prisma.roomBooking.findFirst({
      where: { roomId: newRoomId, meetingId: { not: id }, startsAt: { lt: endsAt }, endsAt: { gt: newScheduledAt } },
      select: { id: true },
    });
    if (overlap) throw new ValidationError("Room is already booked during this time", "ROOM_CONFLICT");
  }

  if (data.agendaItems) {
    await prisma.agendaItem.deleteMany({ where: { meetingId: id } });
    for (const item of data.agendaItems) {
      await prisma.agendaItem.create({
        data: {
          meetingId: id,
          title: item.title,
          durationSeconds: item.durationSeconds ?? 0,
          notes: item.notes,
          sortOrder: data.agendaItems.indexOf(item),
          speakers: item.speakerIds?.length
            ? { create: item.speakerIds.map((sid) => ({ userId: sid })) }
            : undefined,
        },
      });
    }
  }

  const updated = await prisma.meeting.update({
    where: { id },
    data: updateData,
    include: meetingInclude,
  });

  await upsertRoomBooking(id, newRoomId, newScheduledAt, newDuration);

  return updated;
}

export async function scheduleMeeting(id: string, userId: string, scheduledAt?: string) {
  await assertNotLocked(id);
  const meeting = await prisma.meeting.findUnique({ where: { id } });
  if (!meeting ) throw new NotFoundError("Meeting");
  if (meeting.status !== "DRAFT") {
    throw new ValidationError("Only Draft meetings can be scheduled");
  }

  if (!scheduledAt) {
    throw new ValidationError("scheduledAt is required to schedule a meeting", "SCHEDULED_AT_REQUIRED");
  }

  const newScheduledAt = new Date(scheduledAt);
  if (isNaN(newScheduledAt.getTime())) {
    throw new ValidationError("scheduledAt must be a valid date", "INVALID_SCHEDULED_AT");
  }
  if (newScheduledAt <= new Date()) {
    throw new ValidationError("scheduledAt must be in the future", "PAST_SCHEDULED_AT");
  }

  const durationSeconds = meeting.plannedDurationSeconds ?? meeting.plannedDurationSeconds;
  if (!durationSeconds || durationSeconds <= 0) {
    throw new ValidationError("Meeting must have a valid duration before scheduling", "INVALID_DURATION");
  }

  // Only Secretary or creating Team Admin (for their own team) can schedule
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { operationalRole: true, functionalTeamId: true } });
  const isSec = user?.operationalRole === "SECRETARY";
  const isCreatorAndTeamAdmin = meeting.createdById === userId && user?.operationalRole === "TEAM_ADMIN" && user.functionalTeamId && meeting.ownerTeamId === user.functionalTeamId;
  if (!isSec && !isCreatorAndTeamAdmin) {
    throw new ForbiddenError("Only a secretary or the creating Team Admin can schedule this meeting");
  }

  if (meeting.roomId) {
    const endsAt = new Date(newScheduledAt.getTime() + durationSeconds * 1000);
    const conflicting = await prisma.roomBooking.findFirst({
      where: {
        roomId: meeting.roomId,
        meetingId: { not: id },
        startsAt: { lt: endsAt },
        endsAt: { gt: newScheduledAt },
      },
    });
    if (conflicting) {
      throw new ValidationError("Room is already booked during this time", "ROOM_CONFLICT");
    }
  }

  const updated = await prisma.meeting.update({
    where: { id },
    data: { status: "SCHEDULED", scheduledAt: newScheduledAt },
    include: meetingInclude,
  });

  await upsertRoomBooking(id, meeting.roomId, newScheduledAt, durationSeconds);

  return updated;
}

export async function startMeeting(id: string, userId: string) {
  await assertNotLocked(id);
  const meeting = await prisma.meeting.findUnique({
    where: { id },
    include: { agendaItems: { orderBy: { sortOrder: "asc" } } },
  });
  if (!meeting ) throw new NotFoundError("Meeting");
  if (meeting.status !== "SCHEDULED") {
    throw new ValidationError("Only Scheduled meetings can be started");
  }
  if (meeting.organizerId !== userId) {
    throw new ForbiddenError("Only the meeting organizer can start the meeting");
  }

  const now = new Date();
  const isStructured = meeting.kind === "STRUCTURED";
  const firstItem = isStructured ? meeting.agendaItems[0] ?? null : null;

  // Use $transaction to update meeting + upsert timer + activate first item atomically
  const updated = await prisma.$transaction(async (tx) => {
    const m = await tx.meeting.update({
      where: { id },
      data: { status: "IN_PROGRESS", actualDurationSeconds: 0 },
      include: meetingInclude,
    });

    await tx.meetingTimer.upsert({
      where: { meetingId: id },
      create: {
        meetingId: id,
        startedAt: now,
        activeAgendaItemId: firstItem?.id ?? null,
        activeItemStartedAt: firstItem ? now : null,
        version: 0,
      },
      update: {
        startedAt: now,
        activeAgendaItem: firstItem ? { connect: { id: firstItem.id } } : { disconnect: true },
        activeItemStartedAt: firstItem ? now : null,
        overtimeStartedAt: null,
        overtimeDeadlineAt: null,
        overtimeExtensionCount: 0,
        version: 0,
      },
    });

    if (firstItem) {
      await tx.agendaItem.update({
        where: { id: firstItem.id },
        data: { status: "IN_PROGRESS", activatedAt: now },
      });
    }

    return m;
  });

  // Read back fresh state for live event
  const fresh = await prisma.meeting.findUnique({
    where: { id },
    include: { timer: true, agendaItems: { orderBy: { sortOrder: "asc" } } },
  });
  if (fresh) {
    const liveState = buildLiveState(fresh, fresh.timer, fresh.agendaItems, new Date());
    emitLiveState(id, liveState);
  }
  return updated;
}

export async function endMeeting(id: string, userId: string) {
  const meeting = await prisma.meeting.findUnique({ where: { id } });
  if (!meeting ) throw new NotFoundError("Meeting");
  assertTransition(meeting.status as MeetingStatus, "ENDED_PENDING_SUMMARY");

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { operationalRole: true } });
  const isSec = user?.operationalRole === "SECRETARY";
  if (meeting.organizerId !== userId && !isSec) {
    throw new ForbiddenError("Only the meeting organizer or a secretary can end the meeting");
  }

  const timer = await prisma.meetingTimer.findUnique({ where: { meetingId: id } });
  const now = new Date();
  const actualDurationSeconds = timer?.startedAt
    ? Math.floor((now.getTime() - timer.startedAt.getTime()) / 1000)
    : undefined;

  const updated = await prisma.meeting.update({
    where: { id },
    data: {
      status: "ENDED_PENDING_SUMMARY",
      actualDurationSeconds,
      endedAt: now,
      summaryDeadlineAt: new Date(now.getTime() + 5 * 60 * 1000),
      summaryAutoLockedAt: new Date(now.getTime() + 60 * 60 * 1000),
    },
    include: meetingInclude,
  });

  const liveState = buildLiveState(updated, updated.timer, updated.agendaItems ?? [], new Date());
  emitLiveState(id, liveState);
  return updated;
}

export async function submitSummary(id: string, userId: string, summary: string) {
  // Reconcile auto-lock first
  await reconcilePendingFinalization(id);

  const meeting = await prisma.meeting.findUnique({ where: { id } });
  if (!meeting ) throw new NotFoundError("Meeting");
  assertTransition(meeting.status as MeetingStatus, "COMPLETED_LOCKED");

  // Only Organizer may submit
  if (meeting.organizerId !== userId) {
    throw new ForbiddenError("Only the meeting organizer can submit the summary");
  }

  if (!summary || !summary.trim()) {
    throw new ValidationError("Summary cannot be empty");
  }

  const now = new Date();
  const updated = await prisma.meeting.update({
    where: { id },
    data: {
      status: "COMPLETED_LOCKED",
      organizerSummary: summary.trim(),
      summarySubmittedAt: now,
      lockedAt: now,
    },
    include: meetingInclude,
  });

  return updated;
}

export async function lockMeeting(id: string, userId: string) {
  const meeting = await prisma.meeting.findUnique({ where: { id } });
  if (!meeting ) throw new NotFoundError("Meeting");
  assertTransition(meeting.status as MeetingStatus, "COMPLETED_LOCKED");

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { operationalRole: true },
  });
  const isSec = user?.operationalRole === "SECRETARY";
  if (meeting.organizerId !== userId && !isSec) {
    throw new ForbiddenError("Only the meeting organizer or a secretary can lock the meeting");
  }

  const now = new Date();
  const updated = await prisma.meeting.update({
    where: { id },
    data: {
      status: "COMPLETED_LOCKED",
      lockedAt: now,
    },
    include: meetingInclude,
  });

  return updated;
}

export async function reconcilePendingFinalization(meetingId: string, now: Date = new Date()) {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: { status: true, summaryAutoLockedAt: true },
  });
  if (!meeting) return null;
  if (meeting.status !== "ENDED_PENDING_SUMMARY") return null;
  if (!meeting.summaryAutoLockedAt || now < meeting.summaryAutoLockedAt) return null;

  return prisma.meeting.update({
    where: { id: meetingId },
    data: {
      status: "COMPLETED_LOCKED",
      lockedAt: now,
    },
  });
}

export async function completeMeeting(id: string, userId: string) {
  throw new ValidationError("Legacy complete command is disabled. Use POST /meetings/:id/end instead", "LEGACY_COMMAND_DISABLED");
}

export async function archiveMeeting(id: string, userId: string) {
  throw new ValidationError("Legacy archive command is disabled. ARCHIVED is a legacy-only status", "LEGACY_COMMAND_DISABLED");
}

export async function cancelMeeting(
  id: string,
  userId: string,
  executiveRequestDisposition?: "RETURN_TO_PLANNING" | "CANCEL_REQUEST"
) {
  const meeting = await prisma.meeting.findUnique({
    where: { id },
    include: { attendees: { select: { userId: true } } },
  });
  if (!meeting ) throw new NotFoundError("Meeting");

  // Only Draft or Scheduled can be cancelled
  if (meeting.status !== "DRAFT" && meeting.status !== "SCHEDULED") {
    throw new ValidationError("Only Draft or Scheduled meetings can be cancelled");
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { operationalRole: true, functionalTeamId: true } });
  const isSec = user?.operationalRole === "SECRETARY";

  if (meeting.executiveRequestId) {
    const erId = meeting.executiveRequestId;
    // Request-derived meeting: Secretary only
    if (!isSec) {
      throw new ForbiddenError("Only a secretary can cancel a request-derived meeting");
    }
    if (!executiveRequestDisposition) {
      throw new ValidationError("executiveRequestDisposition is required for request-derived meetings");
    }
    if (executiveRequestDisposition !== "RETURN_TO_PLANNING" && executiveRequestDisposition !== "CANCEL_REQUEST") {
      throw new ValidationError("executiveRequestDisposition must be RETURN_TO_PLANNING or CANCEL_REQUEST");
    }

    // Run all changes in one transaction
    const updated = await prisma.$transaction(async (tx) => {
      const cancelled = await tx.meeting.update({
        where: { id },
        data: { status: "CANCELLED" },
        include: meetingInclude,
      });

      // Release room booking
      await tx.roomBooking.deleteMany({ where: { meetingId: id } });

      if (executiveRequestDisposition === "RETURN_TO_PLANNING") {
        await tx.executiveRequest.update({
          where: { id: erId },
          data: { status: "PLANNING", currentMeetingId: null },
        });
      } else {
        await tx.executiveRequest.update({
          where: { id: erId },
          data: { status: "CANCELLED", currentMeetingId: null, cancelledAt: new Date() },
        });
      }

      const attendeeIds = meeting.attendees.map((a) => a.userId);
      if (attendeeIds.length > 0) {
        await tx.notification.createMany({
          data: attendeeIds.map((uid) => ({
            userId: uid,
            type: "MEETING_CANCELLED",
            title: `Meeting cancelled: ${meeting.title}`,
            body: `The meeting "${meeting.title}" has been cancelled.`,
            data: { meetingId: id },
          })),
        });
      }

      return cancelled;
    });

    return updated;
  }

  // Normal meeting: Secretary or original creator (if still Team Admin of ownerTeam)
  const isCreatorAndTeamAdmin = meeting.createdById === userId && user?.operationalRole === "TEAM_ADMIN" && user.functionalTeamId && meeting.ownerTeamId === user.functionalTeamId;
  if (!isSec && !isCreatorAndTeamAdmin) {
    throw new ForbiddenError("Only a secretary or the original creator (as Team Admin) can cancel this meeting");
  }

  const updated = await prisma.meeting.update({
    where: { id },
    data: { status: "CANCELLED" },
    include: meetingInclude,
  });

  // Release room booking
  await prisma.roomBooking.deleteMany({ where: { meetingId: id } });

  const attendeeIds = meeting.attendees.map((a) => a.userId);
  if (attendeeIds.length > 0) {
    await prisma.notification.createMany({
      data: attendeeIds.map((uid) => ({
        userId: uid,
        type: "MEETING_CANCELLED",
        title: `Meeting cancelled: ${meeting.title}`,
        body: `The meeting "${meeting.title}" has been cancelled.`,
        data: { meetingId: id },
      })),
    });
  }

  return updated;
}

// ── Phase 3d: Secretary-controlled overrides ──────────────

const overrideScheduleSchema = z.object({
  scheduledAt: z.string().optional(),
  plannedDurationSeconds: z.number().int().positive().optional(),
  locationType: z.enum(["PHYSICAL", "ONLINE", "HYBRID"]).optional(),
  roomId: z.string().nullable().optional(),
  onlineLink: z.string().nullable().optional(),
  allowRoomConflictOverride: z.boolean().optional(),
  reason: z.string().trim().min(1, "Reason is required"),
}).strict();

const overrideOrganizerSchema = z.object({
  organizerId: z.string(),
  reason: z.string().trim().min(1, "Reason is required"),
}).strict();

function getPeriodWindow(preferredPeriod: string): { startHour: number; endHour: number } {
  if (preferredPeriod === "MORNING") return { startHour: 8, endHour: 12 };
  return { startHour: 13, endHour: 17 };
}

export async function overrideScheduleMeeting(id: string, userId: string, body: any) {
  const data = overrideScheduleSchema.parse(body);

  const meeting = await prisma.meeting.findUnique({
    where: { id },
    include: { attendees: { select: { userId: true } }, room: true, executiveRequest: true, organization: true },
  });
  if (!meeting ) throw new NotFoundError("Meeting");
  if (meeting.kind !== "STRUCTURED") throw new ValidationError("Overrides only apply to Structured meetings");
  if (meeting.status !== "SCHEDULED") throw new ValidationError("Override only allowed on Scheduled meetings");

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { operationalRole: true, organizationId: true } });
  if (!user || user.operationalRole !== "SECRETARY") throw new ForbiddenError("Only a secretary can use overrides");
  if (user.organizationId !== meeting.organizationId) throw new ForbiddenError("Secretary must belong to the same organization");

  // Validate location combination if locationType is changing
  const newLocationType = data.locationType ?? meeting.locationType;
  if (data.locationType !== undefined) {
    const loc = data.locationType;
    if (loc === "PHYSICAL" && (!data.roomId && data.roomId !== null ? meeting.roomId : data.roomId) == null) {
      throw new ValidationError("Physical location requires a room");
    }
    if (loc === "PHYSICAL" && (data.onlineLink !== undefined ? data.onlineLink : meeting.onlineLink) != null) {
      throw new ValidationError("Physical meetings cannot have an online link");
    }
    if (loc === "ONLINE" && (data.onlineLink !== undefined ? data.onlineLink : meeting.onlineLink) == null) {
      throw new ValidationError("Online location requires an online link");
    }
    if (loc === "ONLINE" && (data.roomId !== undefined ? data.roomId : meeting.roomId) != null) {
      throw new ValidationError("Online meetings cannot have a room");
    }
    if (loc === "HYBRID" && (data.roomId !== undefined ? data.roomId : meeting.roomId) == null) {
      throw new ValidationError("Hybrid location requires a room");
    }
    if (loc === "HYBRID" && (data.onlineLink !== undefined ? data.onlineLink : meeting.onlineLink) == null) {
      throw new ValidationError("Hybrid location requires an online link");
    }
  }

  // At least one field must change
  const hasScheduledAtChange = data.scheduledAt !== undefined;
  const hasDurationChange = data.plannedDurationSeconds !== undefined;
  const hasRoomChange = data.roomId !== undefined;
  const hasLocationTypeChange = data.locationType !== undefined;
  const hasOnlineLinkChange = data.onlineLink !== undefined;
  if (!hasScheduledAtChange && !hasDurationChange && !hasRoomChange && !hasLocationTypeChange && !hasOnlineLinkChange) {
    throw new ValidationError("At least one field must change");
  }

  const newScheduledAt = data.scheduledAt !== undefined ? new Date(data.scheduledAt) : meeting.scheduledAt;
  const newDuration = data.plannedDurationSeconds ?? meeting.plannedDurationSeconds ?? meeting.plannedDurationSeconds;
  const newRoomId = data.roomId !== undefined ? data.roomId : meeting.roomId;

  // Validate future date
  if (data.scheduledAt !== undefined) {
    if (isNaN(newScheduledAt!.getTime())) throw new ValidationError("scheduledAt must be a valid date");
    if (newScheduledAt! <= new Date()) throw new ValidationError("scheduledAt must be in the future");
  }

  // Validate positive duration
  if (!newDuration || newDuration <= 0) throw new ValidationError("Duration must be positive");

  // If linked to an Executive Request, validate inside requested date/window
  if (meeting.executiveRequestId && meeting.executiveRequest) {
    const er = meeting.executiveRequest;
    const erDate = new Date(er.requestedDate);
    const { startHour, endHour } = getPeriodWindow(er.preferredPeriod);

    const schedDate = new Date(newScheduledAt!);
    if (schedDate.toISOString().slice(0, 10) !== erDate.toISOString().slice(0, 10)) {
      throw new ValidationError("Cannot move ER-linked meeting outside the requested date");
    }

    const startMinutes = schedDate.getUTCHours() * 60 + schedDate.getUTCMinutes();
    const startBoundary = startHour * 60;
    if (startMinutes < startBoundary) throw new ValidationError("Start time is before the requested period window");

    const endDate = new Date(schedDate.getTime() + newDuration * 1000);
    const endMinutes = endDate.getUTCHours() * 60 + endDate.getUTCMinutes();
    const endBoundary = endHour * 60;
    if (endMinutes > endBoundary) throw new ValidationError("End time exceeds the requested period window");
  }

  // Room conflict check
  let roomConflictOverridden = false;
  if (newRoomId && newScheduledAt) {
    const endsAt = new Date(newScheduledAt.getTime() + newDuration * 1000);
    const conflicting = await prisma.roomBooking.findFirst({
      where: {
        roomId: newRoomId,
        meetingId: { not: id },
        startsAt: { lt: endsAt },
        endsAt: { gt: newScheduledAt },
      },
    });
    if (conflicting) {
      if (!data.allowRoomConflictOverride) {
        throw new ValidationError("Room is already booked during this time", "ROOM_CONFLICT");
      }
      roomConflictOverridden = true;
    }
  }

  // Build notification payloads
  const attendeeIds = meeting.attendees.map((a) => a.userId);
  const notifs: { userId: string; type: any; title: string; body: string; data: any }[] = [];
  const timeChanged = hasScheduledAtChange || hasDurationChange;
  const roomChanged = hasRoomChange && meeting.roomId !== newRoomId;

  const locationParts: string[] = [];
  if (timeChanged) locationParts.push("schedule");
  if (roomChanged) locationParts.push("room");
  if (hasLocationTypeChange) locationParts.push("location type");
  if (hasOnlineLinkChange) locationParts.push("online link");
  const label = locationParts.length > 0 ? locationParts.join(" and ") : "";

  if (locationParts.length > 0 && attendeeIds.length > 0) {
    notifs.push(...attendeeIds.map((uid) => ({
      userId: uid,
      type: "MEETING_UPDATED",
      title: `Meeting updated: ${meeting.title}`,
      body: `The ${label} for "${meeting.title}" has been updated.`,
      data: { meetingId: id },
    })));
  }

  // Execute in transaction
  const updated = await prisma.$transaction(async (tx) => {
    const updateData: any = {};
    if (hasScheduledAtChange) updateData.scheduledAt = newScheduledAt;
    if (hasDurationChange) updateData.plannedDurationSeconds = newDuration;
    if (hasLocationTypeChange) updateData.locationType = data.locationType;
    if (hasRoomChange) updateData.roomId = newRoomId;
    if (hasOnlineLinkChange) updateData.onlineLink = data.onlineLink;

    const result = await tx.meeting.update({
      where: { id },
      data: updateData,
      include: meetingInclude,
    });

    // Release old booking + create new
    await tx.roomBooking.deleteMany({ where: { meetingId: id } });
    if (newRoomId && newScheduledAt) {
      const endsAt = new Date(newScheduledAt.getTime() + newDuration * 1000);
      await tx.roomBooking.create({
        data: { meetingId: id, roomId: newRoomId, startsAt: newScheduledAt, endsAt },
      });
    }

    // Audit event
    const timelineDetails: any = {
      actorId: userId,
      reason: data.reason,
      oldScheduledAt: meeting.scheduledAt?.toISOString() ?? null,
      newScheduledAt: newScheduledAt?.toISOString() ?? null,
      oldDurationSeconds: (meeting.plannedDurationSeconds ?? meeting.plannedDurationSeconds),
      newDurationSeconds: newDuration,
      oldRoomId: meeting.roomId,
      newRoomId,
      roomConflictOverrideUsed: roomConflictOverridden,
    };

    await tx.auditEvent.create({
      data: {
        organizationId: meeting.organizationId,
        meetingId: id,
        action: roomConflictOverridden ? "room_conflict_overridden" : "meeting_schedule_overridden",
        entityType: "meeting",
        entityId: id,
        actorId: userId,
        details: timelineDetails,
      },
    });

    // Notifications
    if (notifs.length > 0) {
      await tx.notification.createMany({ data: notifs as any });
    }

    return result;
  });

  return updated;
}

export async function overrideOrganizer(id: string, userId: string, body: any) {
  const data = overrideOrganizerSchema.parse(body);

  const meeting = await prisma.meeting.findUnique({
    where: { id },
    include: { attendees: { select: { userId: true } }, organization: true },
  });
  if (!meeting ) throw new NotFoundError("Meeting");
  if (meeting.kind !== "STRUCTURED") throw new ValidationError("Overrides only apply to Structured meetings");
  if (meeting.status !== "SCHEDULED") throw new ValidationError("Override only allowed on Scheduled meetings");

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { operationalRole: true, organizationId: true } });
  if (!user || user.operationalRole !== "SECRETARY") throw new ForbiddenError("Only a secretary can use overrides");
  if (user.organizationId !== meeting.organizationId) throw new ForbiddenError("Secretary must belong to the same organization");

  // New organizer must be an official attendee in the same organization
  const newOrg = await prisma.user.findUnique({ where: { id: data.organizerId }, select: { organizationId: true } });
  if (!newOrg) throw new NotFoundError("New organizer not found");
  if (newOrg.organizationId !== meeting.organizationId) throw new ValidationError("New organizer must belong to the same organization");

  const isAttendee = meeting.attendees.some((a) => a.userId === data.organizerId);
  if (!isAttendee) throw new ValidationError("New organizer must be an official attendee of this meeting");

  const updated = await prisma.meeting.update({
    where: { id },
    data: { organizerId: data.organizerId },
    include: meetingInclude,
  });

  await prisma.auditEvent.create({
    data: {
      organizationId: meeting.organizationId,
      actorId: userId,
      meetingId: id,
      action: "organizer_reassigned_by_secretary",
      entityType: "meeting",
      entityId: id,
      details: {
        reason: data.reason,
        oldOrganizerId: meeting.organizerId,
        newOrganizerId: data.organizerId,
      },
    },
  });

  return updated;
}

// ── Phase 3e: Attendee management ─────────────────────────

export async function addMeetingAttendee(meetingId: string, actorId: string, targetUserId: string) {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: { organization: true },
  });
  if (!meeting ) throw new NotFoundError("Meeting");
  if (meeting.kind !== "QUICK_TEAM") throw new ValidationError("Attendee addition is only available for Quick Team meetings");
  if (meeting.status !== "SCHEDULED") throw new ValidationError("Attendees can only be added before the meeting starts");

  const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { operationalRole: true, organizationId: true, functionalTeamId: true } });
  if (!actor) throw new NotFoundError("Actor");
  const isSec = actor.operationalRole === "SECRETARY";
  const isOrg = meeting.organizerId === actorId;
  if (!isSec && !isOrg) throw new ForbiddenError("Only the organizer or a secretary can add attendees");

  const target = await prisma.user.findUnique({ where: { id: targetUserId }, select: { organizationId: true, functionalTeamId: true } });
  if (!target) throw new NotFoundError("Target user");
  if (target.organizationId !== meeting.organizationId) throw new ValidationError("Attendee must belong to the same organization");
  if (target.functionalTeamId !== meeting.ownerTeamId) throw new ValidationError("Cross-team attendee addition is not allowed. Use CrossTeamInvite flow.");

  // Check for existing active attendee (not removed)
  const existing = await prisma.meetingAttendee.findUnique({
    where: { meetingId_userId: { meetingId, userId: targetUserId } },
  });
  if (existing && !existing.removedAt) throw new ValidationError("User is already an active attendee");

  // Re-activate removed attendee or create new
  if (existing && existing.removedAt) {
    return prisma.meetingAttendee.update({
      where: { meetingId_userId: { meetingId, userId: targetUserId } },
      data: { removedAt: null, removedById: null },
    });
  }

  return prisma.meetingAttendee.create({
    data: { meetingId, userId: targetUserId },
  });
}

export async function removeMeetingAttendee(meetingId: string, actorId: string, targetUserId: string) {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: { attendees: { where: { userId: targetUserId } } },
  });
  if (!meeting ) throw new NotFoundError("Meeting");
  if (meeting.status !== "SCHEDULED") throw new ValidationError("Attendees can only be removed before the meeting starts");

  if (targetUserId === actorId) throw new ValidationError("Cannot remove yourself from the meeting");

  const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { operationalRole: true, organizationId: true } });
  if (!actor) throw new NotFoundError("Actor");
  const isSec = actor.operationalRole === "SECRETARY";
  const isOrg = meeting.organizerId === actorId;
  if (!isSec && !isOrg) throw new ForbiddenError("Only the organizer or a secretary can remove attendees");

  if (targetUserId === meeting.organizerId) throw new ValidationError("Cannot remove the current organizer. Reassign organizer first.");

  const attendee = meeting.attendees[0];
  if (!attendee || attendee.removedAt) throw new NotFoundError("Active attendee not found");

  await prisma.meetingAttendee.update({
    where: { id: attendee.id },
    data: { removedAt: new Date(), removedById: actorId },
  });

  await prisma.auditEvent.create({
    data: {
      organizationId: meeting.organizationId,
      meetingId,
      action: "attendee_removed",
      entityType: "meeting",
      entityId: meetingId,
      actorId,
      details: { removedUserId: targetUserId },
    },
  });

  await prisma.notification.createMany({
    data: [{
      userId: targetUserId,
      type: "MEETING_CANCELLED",
      title: `Removed from meeting: ${meeting.title}`,
      body: `You were removed from the meeting "${meeting.title}".`,
      data: { meetingId },
    }],
  });
}

// ── Phase 4a: Live timer & agenda commands ─────────────────

export interface LiveState {
  meetingId: string;
  version: number;
  serverNow: string;
  meetingStatus: string;
  meetingStartedAt: string | null;
  plannedDurationSeconds: number;
  overtimeStartedAt: string | null;
  overtimeDeadlineAt: string | null;
  activeAgendaItemId: string | null;
  activeItemStartedAt: string | null;
  activeItemBudgetSeconds: number | null;
  activeItemExtensionSeconds: number | null;
  agendaComplete: boolean;
}

function buildLiveState(meeting: any, timer: any, items: any[], now: Date): LiveState {
  const plannedSeconds = meeting.plannedDurationSeconds ?? meeting.plannedDurationSeconds;
  const activeItem = timer?.activeAgendaItemId
    ? items.find((i: any) => i.id === timer.activeAgendaItemId)
    : null;
  const activeBudget = activeItem
    ? (activeItem.durationSeconds ?? 0) + (activeItem.extensionSeconds ?? 0)
    : null;
  const agendaComplete = items.length > 0 && items.every(
    (i: any) => i.status === "COMPLETED" || i.status === "SKIPPED"
  );

  return {
    meetingId: meeting.id,
    version: timer?.version ?? 0,
    serverNow: now.toISOString(),
    meetingStatus: meeting.status,
    meetingStartedAt: timer?.startedAt?.toISOString() ?? null,
    plannedDurationSeconds: plannedSeconds,
    overtimeStartedAt: timer?.overtimeStartedAt?.toISOString() ?? null,
    overtimeDeadlineAt: timer?.overtimeDeadlineAt?.toISOString() ?? null,
    activeAgendaItemId: timer?.activeAgendaItemId ?? null,
    activeItemStartedAt: timer?.activeItemStartedAt?.toISOString() ?? null,
    activeItemBudgetSeconds: activeBudget,
    activeItemExtensionSeconds: timer?.activeItemExtensionSeconds ?? 0,
    agendaComplete,
  };
}

function emitLiveState(meetingId: string, state: LiveState) {
  notifyMeetingUpdate(meetingId, "meeting:live-state", state);
}

export async function getLiveState(meetingId: string, userId?: string) {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: { timer: true, agendaItems: { orderBy: { sortOrder: "asc" } } },
  });
  if (!meeting) throw new NotFoundError("Meeting");

  if (userId) {
    const actor = await prisma.user.findUnique({
      where: { id: userId },
      select: { operationalRole: true, organizationId: true },
    });
    const isSec = actor?.operationalRole === "SECRETARY";
    if (!isSec) {
      const isAttendee = await prisma.meetingAttendee.findFirst({
        where: { meetingId, userId, removedAt: null },
      });
      const isOrganizer = meeting.organizerId === userId;
      if (!isAttendee && !isOrganizer) {
        throw new ForbiddenError("You do not have access to this meeting's live state");
      }
    }
  }

  return buildLiveState(meeting, meeting.timer, meeting.agendaItems, new Date());
}

/**
 * Core auto-progression and overtime logic.
 * Idempotent — safe under concurrent workers via version-conditional updates.
 */
export async function reconcileLiveMeeting(meetingId: string, now: Date): Promise<boolean> {
  // Read current state
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: { timer: true, agendaItems: { orderBy: { sortOrder: "asc" } } },
  });
  if (!meeting || meeting.status !== "IN_PROGRESS" || !meeting.timer) return false;

  const timer = meeting.timer;
  const items = meeting.agendaItems;
  const plannedSeconds = meeting.plannedDurationSeconds ?? meeting.plannedDurationSeconds;
  let changed = false;

  // ── Phase 1: Auto-advance agenda items ──
  while (timer.activeAgendaItemId && timer.activeItemStartedAt) {
    const activeItem = items.find((i) => i.id === timer.activeAgendaItemId);
    if (!activeItem || activeItem.status !== "IN_PROGRESS") break;

    const budget = (activeItem.durationSeconds ?? 0) + activeItem.extensionSeconds;
    const itemEnd = new Date(timer.activeItemStartedAt.getTime() + budget * 1000);
    if (now < itemEnd) break; // Not expired yet

    // Complete current item at its calculated boundary
    const completed = await prisma.$transaction(async (tx) => {
      const res = await tx.agendaItem.updateMany({
        where: { id: activeItem.id, status: "IN_PROGRESS" },
        data: {
          status: "COMPLETED",
          completedAt: itemEnd,
          actualDurationSeconds: budget,
        },
      });
      return res.count > 0;
    });
    if (!completed) break; // Another worker already handled it

    // Find next item
    const currentIdx = items.findIndex((i) => i.id === activeItem.id);
    const nextItem = items.slice(currentIdx + 1).find(
      (i) => i.status === "NOT_STARTED"
    );

    if (nextItem) {
      // Activate next item at the same boundary
      await prisma.agendaItem.update({
        where: { id: nextItem.id },
        data: { status: "IN_PROGRESS", activatedAt: itemEnd },
      });

      const updatedTimer = await prisma.meetingTimer.update({
        where: { meetingId, version: timer.version },
        data: {
          activeAgendaItem: { connect: { id: nextItem.id } },
          activeItemStartedAt: itemEnd,
          version: { increment: 1 },
        },
      });

      timer.version = updatedTimer.version;
      timer.activeAgendaItemId = nextItem.id;
      timer.activeItemStartedAt = itemEnd;
      changed = true;
    } else {
      // No more items — agenda complete
      const updatedTimer = await prisma.meetingTimer.update({
        where: { meetingId, version: timer.version },
        data: {
          activeAgendaItem: { disconnect: true },
          activeItemStartedAt: null,
          version: { increment: 1 },
        },
      });

      timer.version = updatedTimer.version;
      timer.activeAgendaItemId = null;
      timer.activeItemStartedAt = null;
      changed = true;
      break;
    }
  }

  // ── Phase 2: Overtime handling ──
  const startedAt = timer.startedAt;
  if (!startedAt) return changed;

  const plannedEnd = new Date(startedAt.getTime() + plannedSeconds * 1000);

  if (!timer.overtimeStartedAt && now >= plannedEnd) {
    const otDeadline = new Date(plannedEnd.getTime() + 5 * 60 * 1000);
    const updatedTimer = await prisma.meetingTimer.update({
      where: { meetingId, version: timer.version },
      data: {
        overtimeStartedAt: plannedEnd,
        overtimeDeadlineAt: otDeadline,
        version: { increment: 1 },
      },
    });
    if (updatedTimer) {
      timer.version = updatedTimer.version;
      timer.overtimeStartedAt = plannedEnd;
      timer.overtimeDeadlineAt = otDeadline;
      changed = true;
    }
  }

  if (timer.overtimeDeadlineAt && now >= timer.overtimeDeadlineAt) {
    const elapsed = Math.floor((now.getTime() - startedAt.getTime()) / 1000);
    const autoEnded = await prisma.$transaction(async (tx) => {
      const m = await tx.meeting.updateMany({
        where: { id: meetingId, status: "IN_PROGRESS" },
        data: {
          status: "ENDED_PENDING_SUMMARY",
          actualDurationSeconds: elapsed,
          endedAt: now,
          summaryDeadlineAt: new Date(now.getTime() + 5 * 60 * 1000),
          summaryAutoLockedAt: new Date(now.getTime() + 60 * 60 * 1000),
        },
      });
      if (m.count > 0) {
        // audit event will be logged separately
      }
      return m.count > 0;
    });
    if (autoEnded) changed = true;
  }

  // ── Phase 3: Timeout warnings ──
  if (timer.activeAgendaItemId && timer.activeItemStartedAt) {
    const activeItem = items.find((i) => i.id === timer.activeAgendaItemId);
    if (activeItem && activeItem.status === "IN_PROGRESS") {
      const budget = (activeItem.durationSeconds ?? 0) + (activeItem.extensionSeconds ?? 0);
      const itemEnd = new Date(timer.activeItemStartedAt.getTime() + budget * 1000);
      const timeLeft = itemEnd.getTime() - now.getTime();
      if (timeLeft > 0 && timeLeft <= 30_000) {
        const existing = await prisma.notification.findFirst({
          where: { userId: meeting.organizerId, type: "MEETING_REMINDER", createdAt: { gte: new Date(now.getTime() - 60_000) } },
        });
        if (!existing) {
          await prisma.notification.create({
            data: { userId: meeting.organizerId, type: "MEETING_REMINDER", title: "Agenda item ending soon", body: `"${activeItem.title}" ends in ${Math.ceil(timeLeft / 1000)}s`, data: { meetingId } },
          });
        }
      }
    }
  }
  if (timer.overtimeDeadlineAt) {
    const timeLeftOvertime = timer.overtimeDeadlineAt.getTime() - now.getTime();
    if (timeLeftOvertime > 0 && timeLeftOvertime <= 30_000) {
      const existing = await prisma.notification.findFirst({
        where: { userId: meeting.organizerId, type: "MEETING_REMINDER", createdAt: { gte: new Date(now.getTime() - 60_000) } },
      });
      if (!existing) {
        await prisma.notification.create({
          data: { userId: meeting.organizerId, type: "MEETING_REMINDER", title: "Meeting overtime ending soon", body: `Overtime ends in ${Math.ceil(timeLeftOvertime / 1000)}s`, data: { meetingId } },
        });
      }
    }
  }

  if (changed) {
    const updatedMeeting = await prisma.meeting.findUnique({
      where: { id: meetingId },
      include: { timer: true, agendaItems: { orderBy: { sortOrder: "asc" } } },
    });
    if (updatedMeeting) {
      const state = buildLiveState(updatedMeeting, updatedMeeting.timer, updatedMeeting.agendaItems, now);
      emitLiveState(meetingId, state);
    }
  }

  return changed;
}

export async function skipCurrentAgendaItem(meetingId: string, userId: string) {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: { timer: true, agendaItems: { orderBy: { sortOrder: "asc" } } },
  });
  if (!meeting ) throw new NotFoundError("Meeting");
  if (meeting.status !== "IN_PROGRESS") throw new ValidationError("Meeting must be InProgress to skip items");
  if (meeting.organizerId !== userId) throw new ForbiddenError("Only the organizer can skip agenda items");

  const timer = meeting.timer;
  if (!timer?.activeAgendaItemId) throw new ValidationError("No active agenda item to skip");

  const activeItem = meeting.agendaItems.find((i) => i.id === timer.activeAgendaItemId);
  if (!activeItem || activeItem.status !== "IN_PROGRESS") throw new ValidationError("No active agenda item to skip");

  const now = new Date();
  const currentIdx = meeting.agendaItems.findIndex((i) => i.id === activeItem.id);
  const nextItem = meeting.agendaItems.slice(currentIdx + 1).find(
    (i) => i.status === "NOT_STARTED"
  );

  await prisma.$transaction(async (tx) => {
    await tx.agendaItem.update({
      where: { id: activeItem.id },
      data: { status: "SKIPPED", skippedAt: now },
    });

    if (nextItem) {
      await tx.agendaItem.update({
        where: { id: nextItem.id },
        data: { status: "IN_PROGRESS", activatedAt: now },
      });

      await tx.meetingTimer.update({
        where: { meetingId },
        data: {
          activeAgendaItem: { connect: { id: nextItem.id } },
          activeItemStartedAt: now,
          version: { increment: 1 },
        },
      });
    } else {
      await tx.meetingTimer.update({
        where: { meetingId },
        data: {
          activeAgendaItem: { disconnect: true },
          activeItemStartedAt: null,
          version: { increment: 1 },
        },
      });
    }
  });

  const updatedMeeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: { timer: true, agendaItems: { orderBy: { sortOrder: "asc" } } },
  });
  if (updatedMeeting) {
    const state = buildLiveState(updatedMeeting, updatedMeeting.timer, updatedMeeting.agendaItems, new Date());
    emitLiveState(meetingId, state);
  }
}

export async function extendCurrentAgendaItem(meetingId: string, userId: string, seconds: number) {
  if (![300, 600, 900].includes(seconds)) {
    throw new ValidationError("Extension must be 300, 600, or 900 seconds");
  }

  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: { timer: true, agendaItems: { orderBy: { sortOrder: "asc" } } },
  });
  if (!meeting ) throw new NotFoundError("Meeting");
  if (meeting.status !== "IN_PROGRESS") throw new ValidationError("Meeting must be InProgress to extend items");
  if (meeting.organizerId !== userId) throw new ForbiddenError("Only the organizer can extend agenda items");

  const timer = meeting.timer;
  if (!timer?.activeAgendaItemId) throw new ValidationError("No active agenda item to extend");

  const activeItem = meeting.agendaItems.find((i) => i.id === timer.activeAgendaItemId);
  if (!activeItem || activeItem.status !== "IN_PROGRESS") throw new ValidationError("No active agenda item to extend");

  await prisma.$transaction(async (tx) => {
    await tx.agendaItem.update({
      where: { id: activeItem.id },
      data: { extensionSeconds: activeItem.extensionSeconds + seconds },
    });
    await tx.meetingTimer.update({
      where: { meetingId },
      data: {
        version: { increment: 1 },
      },
    });
  });

  const updatedMeeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: { timer: true, agendaItems: { orderBy: { sortOrder: "asc" } } },
  });
  if (updatedMeeting) {
    const state = buildLiveState(updatedMeeting, updatedMeeting.timer, updatedMeeting.agendaItems, new Date());
    emitLiveState(meetingId, state);
  }
}

export async function extendOvertime(meetingId: string, userId: string, seconds: number) {
  if (seconds !== 300) {
    throw new ValidationError("Overtime extension must be 300 seconds");
  }

  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: { timer: true },
  });
  if (!meeting ) throw new NotFoundError("Meeting");
  if (meeting.status !== "IN_PROGRESS") throw new ValidationError("Meeting must be InProgress to extend overtime");
  if (meeting.organizerId !== userId) throw new ForbiddenError("Only the organizer can extend overtime");

  const timer = meeting.timer;
  if (!timer?.overtimeStartedAt) throw new ValidationError("Overtime is not active");

  const now = new Date();
  const newDeadline = new Date(now.getTime() + seconds * 1000);

  await prisma.$transaction(async (tx) => {
    await tx.meetingTimer.update({
      where: { meetingId },
      data: {
        overtimeDeadlineAt: newDeadline,
        overtimeExtensionCount: timer.overtimeExtensionCount + 1,
        version: { increment: 1 },
      },
    });
  });

  const updatedMeeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: { timer: true, agendaItems: { orderBy: { sortOrder: "asc" } } },
  });
  if (updatedMeeting) {
    const state = buildLiveState(updatedMeeting, updatedMeeting.timer, updatedMeeting.agendaItems, new Date());
    emitLiveState(meetingId, state);
  }
}

export async function takeoverMeeting(meetingId: string, userId: string) {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: { timer: true, agendaItems: { orderBy: { sortOrder: "asc" } } },
  });
  if (!meeting) throw new NotFoundError("Meeting");
  if (meeting.status !== "SCHEDULED" && meeting.status !== "IN_PROGRESS") {
    throw new ValidationError("Takeover is only allowed for Scheduled or InProgress meetings");
  }

  const actor = await prisma.user.findUnique({ where: { id: userId }, select: { operationalRole: true } });
  if (actor?.operationalRole !== "SECRETARY") throw new ForbiddenError("Only a secretary can takeover a meeting");

  const previousOrganizerId = meeting.organizerId;
  const updated = await prisma.meeting.update({
    where: { id: meetingId },
    data: { organizerId: userId },
    include: meetingInclude,
  });

  await logAuditEvent({
    organizationId: meeting.organizationId,
    meetingId,
    action: "takeover",
    actorId: userId,
    entityType: "meeting",
    entityId: meetingId,
    details: { previousOrganizerId, newOrganizerId: userId },
  });

  if (meeting.status === "IN_PROGRESS") {
    const state = buildLiveState(updated, updated.timer ?? meeting.timer, updated.agendaItems ?? meeting.agendaItems, new Date());
    emitLiveState(meetingId, state);
  }

  return updated;
}

export async function deleteMeeting(id: string, userId: string) {
  const meeting = await prisma.meeting.findUnique({ where: { id } });
  if (!meeting) throw new NotFoundError("Meeting");
  if (meeting.createdById !== userId) throw new ForbiddenError("Only the creator can delete a meeting");

  if (meeting.status === "IN_PROGRESS") {
    throw new ValidationError("Cannot delete a meeting while it is in progress");
  }
  if (meeting.status === "COMPLETED_LOCKED") {
    throw new ValidationError("Cannot delete a locked meeting");
  }
  if (meeting.status === "ENDED_PENDING_SUMMARY") {
    throw new ValidationError("Cannot delete a meeting that has ended pending summary");
  }

  return prisma.$transaction(async (tx) => {
    await tx.roomBooking.deleteMany({ where: { meetingId: id } });
    return tx.meeting.delete({ where: { id } });
  });
}

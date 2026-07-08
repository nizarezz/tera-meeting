import { prisma } from "../../config/database";
import { buildMeetingVisibilityFilter } from "../../policies/meeting-visibility";

export async function getDashboard(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { organizationId: true, operationalRole: true, functionalTeamId: true, isExecutive: true },
  });
  if (!user) throw new Error("User not found");

  const org = await prisma.organization.findUnique({
    where: { id: user.organizationId },
    select: { timezone: true },
  });
  const timezone = org?.timezone ?? "UTC";

  const visibilityFilter = await buildMeetingVisibilityFilter(userId);

  const now = new Date();
  const nowUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const todayStart = new Date(nowUtc);
  const todayEnd = new Date(nowUtc + 24 * 60 * 60 * 1000);

  const meetingInclude = {
    attendees: { where: { removedAt: null }, select: { userId: true } },
    ownerTeam: { select: { id: true, name: true } },
  };

  const [
    todayCount,
    allLive,
    allSummary,
    allRecent,
    nextMeeting,
    pendingDrafts,
    unreadCount,
  ] = await Promise.all([
    prisma.meeting.count({
      where: {
        ...visibilityFilter,
        status: { in: ["SCHEDULED", "IN_PROGRESS"] },
        scheduledAt: { gte: todayStart, lt: todayEnd },
      },
    }),
    prisma.meeting.findMany({
      where: { ...visibilityFilter, status: "IN_PROGRESS" },
      include: meetingInclude,
      orderBy: { scheduledAt: "asc" },
      take: 3,
    }),
    prisma.meeting.findMany({
      where: { ...visibilityFilter, status: "ENDED_PENDING_SUMMARY" },
      include: meetingInclude,
      orderBy: { updatedAt: "desc" },
      take: 10,
    }),
    prisma.meeting.findMany({
      where: { ...visibilityFilter, status: "COMPLETED_LOCKED" },
      include: meetingInclude,
      orderBy: { lockedAt: "desc" },
      take: 5,
    }),
    prisma.meeting.findFirst({
      where: {
        ...visibilityFilter,
        status: "SCHEDULED",
        scheduledAt: { gt: now },
      },
      include: meetingInclude,
      orderBy: { scheduledAt: "asc" },
    }),
    prisma.meeting.count({
      where: { ...visibilityFilter, status: "DRAFT" },
    }),
    prisma.notification.count({
      where: { userId, readAt: null },
    }),
  ]);

  const isSecretary = user.operationalRole === "SECRETARY";
  const isTeamAdmin = user.operationalRole === "TEAM_ADMIN";
  const canCreateQuick = isSecretary || isTeamAdmin;
  const canCreateStructured = isSecretary || isTeamAdmin;
  const canCreateExecutiveRequest = user.isExecutive;

  function toCard(m: any) {
    const isOrganizer = m.organizerId === userId;
    const isAttendee = m.attendees?.some((a: any) => a.userId === userId);
    const hasSpeaker = false;
    const canEnterLive = (m.status === "IN_PROGRESS" && (isOrganizer || isSecretary || isAttendee || hasSpeaker)) ||
      (m.status === "SCHEDULED" && (isOrganizer || isSecretary) &&
        (!m.scheduledAt || m.scheduledAt.getTime() - Date.now() <= 3600_000));
    const canViewSummary = m.status === "ENDED_PENDING_SUMMARY" || m.status === "COMPLETED_LOCKED";
    const canSubmitSummary = m.status === "ENDED_PENDING_SUMMARY" && (isOrganizer || isSecretary);

    return {
      id: m.id,
      title: m.title,
      status: m.status,
      scheduledAt: m.scheduledAt?.toISOString() ?? null,
      plannedDurationSeconds: m.plannedDurationSeconds,
      actualDurationSeconds: m.actualDurationSeconds ?? null,
      ownerTeam: m.ownerTeam ?? { id: m.ownerTeamId, name: m.ownerTeamId },
      activeAttendeeCount: m.attendees?.length ?? 0,
      capabilities: {
        canOpenLiveRoom: canEnterLive,
        canViewMeetingSummary: canViewSummary,
        canSubmitSummary: canSubmitSummary,
      },
    };
  }

  const liveMeetings = allLive.map(toCard);
  const summaryActions = allSummary.filter((m) => m.organizerId === userId).map(toCard);
  const recentRecords = allRecent.map(toCard);

  return {
    timezone,
    todayMeetings: todayCount,
    pendingDrafts,
    unreadCount,
    nextUpcomingMeeting: nextMeeting ? toCard(nextMeeting) : null,
    liveMeetings,
    summaryActions,
    recentRecords,
    capabilities: {
      canCreateQuickMeeting: canCreateQuick,
      canCreateStructuredMeeting: canCreateStructured,
      canCreateExecutiveRequest,
    },
  };
}

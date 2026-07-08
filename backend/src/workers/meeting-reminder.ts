import { prisma } from "../config/database";
import { createNotification } from "../modules/notifications/notifications.service";
import type { Prisma } from "@prisma/client";

const INTERVAL_MS = 60_000;

const WINDOWS = [
  { label: "15min", ms: 15 * 60_000 },
  { label: "1hour", ms: 60 * 60_000 },
];

const AUTO_START_GRACE_MS = 5 * 60_000;

let intervalId: ReturnType<typeof setInterval> | null = null;

async function sendMeetingReminders() {
  const now = new Date();

  for (const window of WINDOWS) {
    const windowStart = new Date(now.getTime() + window.ms - 30_000);
    const windowEnd = new Date(now.getTime() + window.ms + 60_000);

    const meetings = (await prisma.meeting.findMany({
      where: {
        status: "SCHEDULED",
        scheduledAt: { gte: windowStart, lte: windowEnd },
      },
      select: { id: true, title: true, scheduledAt: true },
    })).filter((m): m is typeof m & { scheduledAt: Date } => m.scheduledAt !== null);

    for (const meeting of meetings) {
      const attendees = await prisma.meetingAttendee.findMany({
        where: { meetingId: meeting.id, removedAt: null },
        select: { userId: true },
      });

      for (const attendee of attendees) {
        const existing = await prisma.notification.findFirst({
          where: {
            userId: attendee.userId,
            type: "MEETING_REMINDER",
            data: { path: ["meetingId"], equals: meeting.id },
            createdAt: { gte: new Date(now.getTime() - 120_000) },
          },
        });
        if (existing) continue;

        const timeStr = window.label === "15min"
          ? "15 minutes"
          : "1 hour";

        await createNotification(attendee.userId, {
          type: "MEETING_REMINDER",
          title: `Meeting starts in ${timeStr}`,
          body: `"${meeting.title}" starts in ${timeStr} (${meeting.scheduledAt.toLocaleTimeString()})`,
          meta: { meetingId: meeting.id, reminderWindow: window.label },
        });
      }
    }
  }
}

async function autoStartOverdueMeetings() {
  const deadline = new Date(Date.now() - AUTO_START_GRACE_MS);

  const meetings = await prisma.meeting.findMany({
    where: {
      status: "SCHEDULED",
      scheduledAt: { lte: deadline },
    },
    select: {
      id: true,
      title: true,
      kind: true,
      organizerId: true,
      scheduledAt: true,
      agendaItems: { orderBy: { sortOrder: "asc" as const }, take: 1, select: { id: true } },
    },
  });

  for (const meeting of meetings) {
    const now = new Date();
    const firstItem = meeting.kind === "STRUCTURED" ? meeting.agendaItems[0] ?? null : null;

    try {
      await prisma.$transaction(async (tx) => {
        await tx.meeting.update({
          where: { id: meeting.id, status: "SCHEDULED" },
          data: { status: "IN_PROGRESS", actualDurationSeconds: 0 },
        });

        await tx.meetingTimer.upsert({
          where: { meetingId: meeting.id },
          create: {
            meetingId: meeting.id,
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
      });
    } catch {
      continue;
    }

    const attendees = await prisma.meetingAttendee.findMany({
      where: { meetingId: meeting.id, removedAt: null },
      select: { userId: true },
    });
    for (const att of attendees) {
      await createNotification(att.userId, {
        type: "MEETING_REMINDER",
        title: "Meeting auto-started",
        body: `"${meeting.title}" has started automatically`,
        meta: { meetingId: meeting.id },
      }).catch(() => {});
    }
  }
}

export function startMeetingReminderWorker() {
  if (intervalId) return;
  console.log(`[meeting-reminder] Worker started (interval: ${INTERVAL_MS}ms)`);
  sendMeetingReminders();
  autoStartOverdueMeetings();
  intervalId = setInterval(() => {
    sendMeetingReminders();
    autoStartOverdueMeetings();
  }, INTERVAL_MS);
  intervalId.unref();
}

export function stopMeetingReminderWorker() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log("[meeting-reminder] Worker stopped");
  }
}

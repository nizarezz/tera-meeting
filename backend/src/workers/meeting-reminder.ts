import { prisma } from "../config/database";
import { createNotification } from "../modules/notifications/notifications.service";

const INTERVAL_MS = 60_000;

const WINDOWS = [
  { label: "15min", ms: 15 * 60_000 },
  { label: "1hour", ms: 60 * 60_000 },
];

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

export function startMeetingReminderWorker() {
  if (intervalId) return;
  console.log(`[meeting-reminder] Worker started (interval: ${INTERVAL_MS}ms)`);
  sendMeetingReminders();
  intervalId = setInterval(sendMeetingReminders, INTERVAL_MS);
  intervalId.unref();
}

export function stopMeetingReminderWorker() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log("[meeting-reminder] Worker stopped");
  }
}

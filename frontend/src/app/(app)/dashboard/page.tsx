"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { useDashboard } from "@/lib/api/queries/dashboard";
import { useCurrentUser } from "@/lib/api/queries/auth";
import { StatusBadge, formatDuration, formatDateTime } from "@/features/meetings/meeting-presentation";
import { ScheduleIcon, UsersIcon, CalendarTodayIcon, EditNoteIcon, CheckCircleIcon, PlusIcon, PriorityHighIcon, PlayIcon, EyeIcon } from "@/components/icons";
import type { DashboardMeetingCard } from "@/types/api";

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

const avatarColors = [
  "bg-primary", "bg-tertiary", "bg-secondary",
  "bg-primary/80", "bg-tertiary/80", "bg-secondary/80",
];

export default function DashboardPage() {
  const { data: user } = useCurrentUser();
  const { data: dashboard, isLoading, error } = useDashboard();

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  })();

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-6 overflow-x-hidden">        <div className="space-y-2">
          <div className="h-8 w-64 bg-surface-container-high rounded-lg" />
          <div className="h-4 w-96 bg-surface-container-high rounded-lg" />
        </div>
        <div className="flex gap-3">
          <div className="h-10 w-40 bg-surface-container-high rounded-xl" />
          <div className="h-10 w-48 bg-surface-container-high rounded-xl" />
        </div>
        <div className="grid grid-cols-12 gap-5">
          <div className="col-span-12 lg:col-span-8">
            <div className="h-[200px] bg-surface-container-high rounded-2xl" />
          </div>
          <div className="col-span-12 lg:col-span-4">
            <div className="h-[200px] bg-surface-container-high rounded-2xl" />
          </div>
          <div className="col-span-12 lg:col-span-4">
            <div className="h-[180px] bg-surface-container-high rounded-2xl" />
          </div>
          <div className="col-span-12 lg:col-span-8">
            <div className="h-[240px] bg-surface-container-high rounded-2xl" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !dashboard) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-error/10 flex items-center justify-center mx-auto">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6 text-error">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" x2="12" y1="8" y2="12" />
              <line x1="12" x2="12.01" y1="16" y2="16" />
            </svg>
          </div>
          <p className="text-secondary font-medium">Failed to load dashboard</p>
          <Link href="/dashboard" className="text-sm text-primary font-semibold hover:underline">Retry</Link>
        </div>
      </div>
    );
  }

  const { timezone, todayMeetings, nextUpcomingMeeting, liveMeetings, summaryActions, recentRecords, capabilities } = dashboard;

  const showScheduleCta = capabilities.canCreateQuickMeeting || capabilities.canCreateStructuredMeeting;
  const showExecCta = capabilities.canCreateExecutiveRequest;

  return (
    <div className="p-4 md:p-6 space-y-6 overflow-x-hidden">
      <header className="space-y-1">
        <h1 className="font-headline text-3xl font-bold text-on-surface">
          {greeting}, {user?.name?.split(" ")[0] ?? "there"}.
        </h1>
        <p className="text-secondary">
          {todayMeetings > 0
            ? `You have ${todayMeetings} meeting${todayMeetings > 1 ? "s" : ""} today${nextUpcomingMeeting ? ` — your next one starts soon.` : "."}`
            : "No meetings scheduled for today. Enjoy the calm!"}
        </p>
      </header>

      <div className="flex gap-2 flex-wrap">
        {showScheduleCta && (
          <Link
            href="/meetings/new"
            className="inline-flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-5 py-2.5 text-sm font-semibold hover:brightness-110 active:scale-[0.98] transition-all"
          >
            <PlusIcon className="h-4 w-4" />
            Schedule Meeting
          </Link>
        )}
        {showExecCta && (
          <Link
            href="/executive-requests/new"
            className="inline-flex items-center gap-2 rounded-xl bg-tertiary text-tertiary-foreground px-5 py-2.5 text-sm font-semibold hover:brightness-110 active:scale-[0.98] transition-all"
          >
            <PriorityHighIcon className="h-4 w-4" />
            Create Executive Request
          </Link>
        )}
      </div>

      <div className="grid grid-cols-12 gap-5">
        {/* Hero — Next Upcoming Meeting */}
        <div className="col-span-12 lg:col-span-8">
          {nextUpcomingMeeting ? (
            <DashboardCard meeting={nextUpcomingMeeting} timezone={timezone} hero />
          ) : (
            <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 h-[200px] flex items-center justify-center">
              <div className="text-center space-y-2">
                <CalendarTodayIcon className="h-10 w-10 text-secondary/30 mx-auto" />
                <p className="text-secondary text-sm">No upcoming meetings</p>
                {showScheduleCta && (
                  <Link
                    href="/meetings/new"
                    className="inline-flex items-center gap-1.5 mt-2 rounded-lg bg-primary/10 text-primary px-4 py-2 text-sm font-semibold hover:bg-primary/20 transition-colors"
                  >
                    <PlusIcon className="h-3.5 w-3.5" />
                    Schedule One
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Side — Live Now */}
        <div className="col-span-12 lg:col-span-4">
          <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 h-full flex flex-col">
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <h3 className="font-headline text-sm font-semibold text-on-surface">Live Now</h3>
              {liveMeetings.length > 0 && (
                <span className="flex items-center gap-1.5 text-[11px] text-error font-bold uppercase tracking-wider">
                  <span className="h-1.5 w-1.5 rounded-full bg-error animate-pulse" />
                  Live
                </span>
              )}
            </div>
            <div className="flex-1 px-5 pb-5">
              {liveMeetings.length > 0 ? (
                <div className="space-y-3">
                  {liveMeetings.map((meeting) => (
                    <Link
                      key={meeting.id}
                      href={meeting.capabilities.canOpenLiveRoom ? `/meetings/${meeting.id}/live` : `/meetings/${meeting.id}`}
                      className="block rounded-xl bg-surface-container p-3.5 border border-outline-variant/10 hover:bg-surface-container-high transition-colors"
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-[10px] font-bold text-secondary uppercase tracking-wider">{meeting.ownerTeam.name}</span>
                        <span className="h-1 w-1 rounded-full bg-error animate-pulse" />
                      </div>
                      <p className="font-medium text-sm text-on-surface mb-2 line-clamp-1">{meeting.title}</p>
                      <div className="flex items-center gap-4 text-xs text-secondary">
                        <span className="flex items-center gap-1">
                          <ScheduleIcon className="h-3 w-3" />
                          {formatDuration(meeting.plannedDurationSeconds)}
                        </span>
                        <span className="flex items-center gap-1">
                          <UsersIcon className="h-3 w-3" />
                          {meeting.activeAttendeeCount}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6">
                  <div className="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center mx-auto">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-secondary/40">
                      <path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9" /><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5" /><circle cx="12" cy="12" r="2" /><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5" /><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19" />
                    </svg>
                  </div>
                  <p className="text-xs text-secondary mt-2">No live meetings</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Your Summaries */}
        <div className="col-span-12 lg:col-span-4">
          <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20">
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <h3 className="font-headline text-sm font-semibold text-on-surface">Your Summaries</h3>
              {summaryActions.length > 0 && (
                <span className="text-[11px] text-secondary font-medium">{summaryActions.length} pending</span>
              )}
            </div>
            <div className="px-5 pb-5">
              {summaryActions.length > 0 ? (
                <div className="space-y-2">
                  {summaryActions.map((meeting) => (
                    <Link
                      key={meeting.id}
                      href={`/meetings/${meeting.id}`}
                      className="flex items-start gap-3 rounded-xl bg-surface-container p-3 border border-outline-variant/10 hover:bg-surface-container-high transition-colors"
                    >
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                        <EditNoteIcon className="h-4 w-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-on-surface truncate">{meeting.title}</p>
                        <div className="flex items-center gap-3 text-xs text-secondary mt-1">
                          {meeting.scheduledAt && <span>{formatDateTime(meeting.scheduledAt, timezone)}</span>}
                          <span>{formatDuration(meeting.plannedDurationSeconds)}</span>
                        </div>
                        <span className="text-xs text-primary mt-1.5 inline-block font-medium">
                          {meeting.capabilities.canSubmitSummary ? "Submit summary" : "View details"}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6">
                  <div className="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center mx-auto">
                    <CheckCircleIcon className="h-5 w-5 text-secondary/40" />
                  </div>
                  <p className="text-xs text-secondary mt-2">All caught up</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Recent Records */}
        <div className="col-span-12 lg:col-span-8">
          <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20">
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <h3 className="font-headline text-sm font-semibold text-on-surface">Recent Records</h3>
              <Link href="/meetings" className="text-xs font-semibold text-primary hover:underline">View all</Link>
            </div>
            <div className="px-5 pb-5">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-outline-variant/20 text-[11px] font-bold text-secondary uppercase tracking-wider">
                      <th className="text-left pb-2.5 pr-4">Title</th>
                      <th className="text-left pb-2.5 pr-4">Duration</th>
                      <th className="text-left pb-2.5 pr-4">Team</th>
                      <th className="text-left pb-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentRecords.length > 0 ? (
                      recentRecords.map((meeting) => (
                        <tr key={meeting.id} className="border-b border-outline-variant/10 last:border-0">
                          <td className="py-2.5 pr-4">
                            <Link href={`/meetings/${meeting.id}`} className="font-medium text-on-surface text-sm hover:text-primary transition-colors">
                              {meeting.title}
                            </Link>
                          </td>
                          <td className="py-2.5 pr-4 text-secondary text-sm">
                            {meeting.actualDurationSeconds
                              ? formatDuration(meeting.actualDurationSeconds)
                              : formatDuration(meeting.plannedDurationSeconds)}
                          </td>
                          <td className="py-2.5 pr-4">
                            <span className="inline-flex items-center rounded-md bg-surface-container-high px-2 py-0.5 text-xs font-medium text-secondary">
                              {meeting.ownerTeam.name}
                            </span>
                          </td>
                          <td className="py-2.5"><StatusBadge status={meeting.status} /></td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-secondary text-sm">No completed meetings yet</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DashboardCard({ meeting, timezone, hero }: { meeting: DashboardMeetingCard; timezone: string; hero?: boolean }) {
  return (
    <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 h-full flex flex-col">
      <div className="px-5 pt-5 pb-4 flex-1">
        <div className="flex items-center gap-2 mb-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary px-2.5 py-0.5 text-[11px] font-bold">
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
            {hero ? "Next up" : <StatusBadge status={meeting.status} />}
          </span>
        </div>
        <h2 className="font-headline text-lg font-semibold text-on-surface mb-3 line-clamp-2">{meeting.title}</h2>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-secondary">
          <span className="flex items-center gap-1.5">
            <ScheduleIcon className="h-4 w-4 text-secondary/60" />
            {formatDuration(meeting.plannedDurationSeconds)}
          </span>
          {meeting.scheduledAt && (
            <span className="flex items-center gap-1.5">
              <CalendarTodayIcon className="h-4 w-4 text-secondary/60" />
              {formatDateTime(meeting.scheduledAt, timezone)}
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <UsersIcon className="h-4 w-4 text-secondary/60" />
            {meeting.activeAttendeeCount} attendee{meeting.activeAttendeeCount !== 1 ? "s" : ""}
          </span>
        </div>
      </div>
      <div className="px-5 pb-5">
        <Link
          href={meeting.capabilities.canOpenLiveRoom ? `/meetings/${meeting.id}/live` : `/meetings/${meeting.id}`}
          className="inline-flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-5 py-2.5 text-sm font-semibold hover:brightness-110 active:scale-[0.98] transition-all"
        >
          {meeting.capabilities.canOpenLiveRoom ? <PlayIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
          {meeting.capabilities.canOpenLiveRoom ? "Open Live Room" : "View Meeting"}
        </Link>
      </div>
    </div>
  );
}

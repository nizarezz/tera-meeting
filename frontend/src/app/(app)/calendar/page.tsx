"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useDayCalendar } from "@/lib/api/queries/calendar";
import { useDashboard } from "@/lib/api/queries/dashboard";
import { StatusBadge, formatDuration, formatTime } from "@/features/meetings/meeting-presentation";
import { AddIcon, CalendarTodayIcon } from "@/components/icons";
import type { CalendarMeetingCard } from "@/types/api";

function getDateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export default function CalendarPage() {
  const today = new Date();
  const [selectedDate, setSelectedDate] = useState(getDateString(today));

  const { data, isLoading, isError } = useDayCalendar(selectedDate);
  const { data: dashboard } = useDashboard();
  const timezone = data?.timezone || "UTC";

  const handleToday = useCallback(() => {
    setSelectedDate(getDateString(new Date()));
  }, []);

  const handleTomorrow = useCallback(() => {
    setSelectedDate(getDateString(addDays(new Date(), 1)));
  }, []);

  const handleDayAfterTomorrow = useCallback(() => {
    setSelectedDate(getDateString(addDays(new Date(), 2)));
  }, []);

  const canCreate = dashboard?.capabilities.canCreateQuickMeeting || dashboard?.capabilities.canCreateStructuredMeeting;

  const meetings = (data?.meetings ?? []).sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
  );

  return (
    <div className="p-4 md:p-6 space-y-6 overflow-x-hidden">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-headline text-3xl font-bold text-on-surface">Calendar</h1>
          <p className="text-secondary mt-1">View your meetings day by day.</p>
        </div>
        {canCreate && (
          <Link
            href="/meetings/new"
            className="inline-flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-5 py-2.5 text-sm font-semibold hover:brightness-110 active:scale-[0.98] transition-all"
          >
            <AddIcon className="h-4 w-4" />
            Schedule Meeting
          </Link>
        )}
      </div>

      <div className="flex items-center gap-2 bg-surface-container-lowest rounded-2xl border border-outline-variant/20 p-2 overflow-x-auto max-w-full">
        <button
          onClick={handleToday}
          className="rounded-xl bg-primary text-primary-foreground px-3 py-1.5 md:px-4 md:py-2 text-sm font-semibold whitespace-nowrap shrink-0 hover:brightness-110 transition-all"
        >
          Today
        </button>
        <button
          onClick={handleTomorrow}
          className="rounded-xl border border-outline-variant bg-background text-on-surface px-3 py-1.5 md:px-4 md:py-2 text-sm font-semibold whitespace-nowrap shrink-0 hover:bg-surface-container-high transition-colors"
        >
          Tomorrow
        </button>
        <button
          onClick={handleDayAfterTomorrow}
          className="rounded-xl border border-outline-variant bg-background text-on-surface px-3 py-1.5 md:px-4 md:py-2 text-sm font-semibold whitespace-nowrap shrink-0 hover:bg-surface-container-high transition-colors"
        >
          Day after tomorrow
        </button>
        <div className="h-6 w-px bg-outline-variant/40 mx-1" />
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="rounded-xl border border-outline-variant bg-background text-sm text-on-surface py-2 px-3 font-medium focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>

      <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20">
        <div className="px-5 py-4 border-b border-outline-variant/10">
          <h2 className="font-headline text-lg font-semibold text-on-surface">
            {new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", {
              weekday: "long", month: "long", day: "numeric", year: "numeric",
            })}
          </h2>
          {meetings.length > 0 && (
            <p className="text-xs text-secondary/60 mt-0.5">{meetings.length} meeting{meetings.length !== 1 ? "s" : ""}</p>
          )}
        </div>

        {isLoading ? (
          <div className="p-12 text-center text-secondary">Loading meetings...</div>
        ) : isError ? (
          <div className="p-12 text-center text-destructive text-sm">Failed to load meetings.</div>
        ) : meetings.length === 0 ? (
          <div className="p-16 text-center">
            <div className="w-14 h-14 rounded-2xl bg-surface-container-high flex items-center justify-center mx-auto mb-4">
              <CalendarTodayIcon className="h-7 w-7 text-secondary/40" />
            </div>
            <p className="text-on-surface font-medium mb-1">No meetings scheduled</p>
            <p className="text-sm text-secondary/60 mb-5">Nothing on the calendar for this day.</p>
            {canCreate && (
              <Link
                href="/meetings/new"
                className="inline-flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-5 py-2.5 text-sm font-semibold hover:brightness-110 active:scale-[0.98] transition-all"
              >
                <AddIcon className="h-4 w-4" />
                Schedule Meeting
              </Link>
            )}
          </div>
        ) : (
          <div className="divide-y divide-outline-variant/10">
            {meetings.map((m) => {
              const isLive = m.status === "IN_PROGRESS";
              const targetUrl = isLive && m.capabilities.canOpenLiveRoom
                ? `/meetings/${m.id}/live`
                : `/meetings/${m.id}`;

              return (
                <Link
                  key={m.id}
                  href={targetUrl}
                  className={`flex items-stretch transition-colors group ${
                    isLive
                      ? "bg-primary/5 hover:bg-primary/8"
                      : "hover:bg-surface-container-low/60"
                  }`}
                >
                  {/* Time column */}
                  <div className="w-24 shrink-0 px-4 py-4 flex flex-col items-end justify-start border-r border-outline-variant/10">
                    <span className="text-sm font-semibold text-on-surface">
                      {formatTime(m.startsAt, timezone)}
                    </span>
                    <span className="text-[11px] text-secondary/50">
                      {formatTime(m.endsAt, timezone)}
                    </span>
                  </div>

                  {/* Accent bar */}
                  <div className={`w-1 shrink-0 ${
                    isLive ? "bg-primary" : m.status === "SCHEDULED" ? "bg-tertiary/40" : "bg-outline-variant/30"
                  }`} />

                  {/* Content */}
                  <div className="flex-1 px-4 py-3.5 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <StatusBadge status={m.status} />
                      <span className="text-[11px] text-secondary/40 font-medium">
                        {formatDuration(m.plannedDurationSeconds)}
                      </span>
                    </div>
                    <p className="text-sm font-semibold text-on-surface truncate group-hover:text-primary transition-colors">
                      {m.title}
                    </p>
                    <p className="text-xs text-secondary/60 mt-0.5 truncate">
                      {m.ownerTeam.name}
                    </p>
                  </div>

                  {/* Arrow */}
                  <div className="pr-4 flex items-center">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-secondary/20 group-hover:text-primary/50 transition-colors">
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

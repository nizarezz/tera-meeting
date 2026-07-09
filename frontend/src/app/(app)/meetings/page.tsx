"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useBrowseMeetings } from "@/lib/api/queries/meetings";
import { useDashboard } from "@/lib/api/queries/dashboard";
import { StatusBadge, KindBadge, formatDuration, formatDateTime } from "@/features/meetings/meeting-presentation";
import { SearchIcon, XIcon, ChevronRightIcon, PlusIcon } from "@/components/icons";
import type { MeetingStatus, MeetingKind, MeetingBrowseCard } from "@/types/api";

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "All Statuses" },
  { value: "DRAFT", label: "Draft" },
  { value: "SCHEDULED", label: "Scheduled" },
  { value: "IN_PROGRESS", label: "Live" },
  { value: "ENDED_PENDING_SUMMARY", label: "Summary Pending" },
  { value: "COMPLETED_LOCKED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
];

const KIND_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "All Kinds" },
  { value: "QUICK_TEAM", label: "Quick" },
  { value: "STRUCTURED", label: "Structured" },
];

const SORT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "UPCOMING", label: "Upcoming" },
  { value: "RECENT", label: "Most Recent" },
  { value: "TITLE", label: "Title A-Z" },
];

function TableSkeleton() {
  return (
    <div className="p-6 space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-14 bg-surface-container-high/50 rounded-lg" />
      ))}
    </div>
  );
}

function ZeroState() {
  return (
    <tr>
      <td colSpan={8} className="py-16 text-center">
        <div className="w-12 h-12 rounded-full bg-surface-container-high flex items-center justify-center mx-auto">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6 text-secondary/40">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        </div>
        <p className="text-secondary text-sm mt-3">No meetings found</p>
      </td>
    </tr>
  );
}

function ErrorState() {
  return (
    <tr>
      <td colSpan={8} className="py-16 text-center">
        <p className="text-destructive text-sm">Failed to load meetings. Please try again.</p>
      </td>
    </tr>
  );
}

function RowAction({ meeting }: { meeting: MeetingBrowseCard }) {
  if (meeting.status === "IN_PROGRESS") {
    if (meeting.capabilities.canOpenLiveRoom) {
      return (
        <Link href={`/meetings/${meeting.id}/live`} className="inline-flex items-center gap-1 rounded-lg bg-primary/10 text-primary px-3 py-1.5 text-xs font-semibold hover:bg-primary/20 transition-colors">
          Open Live Room
        </Link>
      );
    }
  }
  if (meeting.status === "ENDED_PENDING_SUMMARY" || meeting.status === "COMPLETED_LOCKED") {
    if (meeting.capabilities.canViewMeetingSummary) {
      return (
        <Link href={`/meetings/${meeting.id}`} className="inline-flex items-center gap-1 rounded-lg bg-secondary-container/60 text-secondary px-3 py-1.5 text-xs font-semibold hover:bg-secondary-container transition-colors">
          View Summary
        </Link>
      );
    }
  }
  return (
    <Link href={`/meetings/${meeting.id}`} className="inline-flex items-center justify-center w-8 h-8 rounded-lg hover:bg-surface-container-high text-secondary transition-colors">
      <ChevronRightIcon className="h-4 w-4" />
    </Link>
  );
}

export default function MeetingsPage() {
  const [search, setSearch] = useState("");
  const [statuses, setStatuses] = useState("");
  const [kinds, setKinds] = useState("");
  const [ownerTeamId, setOwnerTeamId] = useState("");
  const [sort, setSort] = useState("UPCOMING");

  const [cursor, setCursor] = useState<string | null>(null);
  const [accumulated, setAccumulated] = useState<MeetingBrowseCard[]>([]);

  const { data: dashboard } = useDashboard();
  const filtersKey = JSON.stringify({ statuses, kinds, search, ownerTeamId, sort });

  const filters = useMemo(() => {
    const f: Record<string, string> = {};
    if (statuses) f.statuses = statuses;
    if (kinds) f.kinds = kinds;
    if (search) f.search = search;
    if (ownerTeamId) f.ownerTeamId = ownerTeamId;
    if (sort) f.sort = sort;
    return f;
  }, [statuses, kinds, search, ownerTeamId, sort]);

  const { data, isLoading, isError } = useBrowseMeetings({ ...filters, cursor: cursor ?? undefined, limit: "20" });

  useEffect(() => {
    setAccumulated([]);
    setCursor(null);
  }, [filtersKey]);

  useEffect(() => {
    if (data?.items) {
      setAccumulated(prev => {
        if (!cursor) return data.items;
        return [...prev, ...data.items];
      });
    }
  }, [data, cursor]);

  const handleLoadMore = useCallback(() => {
    if (data?.nextCursor) {
      setCursor(data.nextCursor);
    }
  }, [data?.nextCursor]);

  const teamOptions = useMemo(() => {
    return data?.filterOptions?.teams ?? [];
  }, [data?.filterOptions?.teams]);

  const canCreate = dashboard?.capabilities.canCreateQuickMeeting || dashboard?.capabilities.canCreateStructuredMeeting;

  const clearFilters = useCallback(() => {
    setSearch("");
    setStatuses("");
    setKinds("");
    setOwnerTeamId("");
    setSort("UPCOMING");
  }, []);

  const hasActiveFilters = statuses || kinds || search || ownerTeamId;

  return (
    <div className="p-4 md:p-6 space-y-5 overflow-x-hidden">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-headline text-3xl font-bold text-on-surface">Meetings</h1>
          <p className="text-secondary mt-1">View, schedule, and manage all your team meetings.</p>
        </div>
        {canCreate && (
          <Link
            href="/meetings/new"
            className="inline-flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-5 py-2.5 text-sm font-semibold hover:brightness-110 active:scale-[0.98] transition-all"
          >
            <PlusIcon className="h-4 w-4" />
            Create Meeting
          </Link>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 bg-surface-container-lowest rounded-2xl border border-outline-variant/20 p-2 overflow-x-auto max-w-full">
        <div className="relative flex-1 min-w-[140px] md:min-w-[200px] shrink-0">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-secondary pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            className="w-full rounded-xl border border-outline-variant bg-background text-sm text-on-surface py-1.5 md:py-2.5 pl-10 pr-3 font-medium placeholder:text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
          />
        </div>
        <select
          value={statuses}
          onChange={(e) => setStatuses(e.target.value)}
          className="appearance-none rounded-xl border border-outline-variant bg-background text-sm text-on-surface py-1.5 md:py-2.5 pl-2.5 md:pl-3 pr-6 md:pr-8 font-medium focus:outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer shrink-0"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <select
          value={kinds}
          onChange={(e) => setKinds(e.target.value)}
          className="appearance-none rounded-xl border border-outline-variant bg-background text-sm text-on-surface py-1.5 md:py-2.5 pl-2.5 md:pl-3 pr-6 md:pr-8 font-medium focus:outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer shrink-0"
        >
          {KIND_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <select
          value={ownerTeamId}
          onChange={(e) => setOwnerTeamId(e.target.value)}
          className="appearance-none rounded-xl border border-outline-variant bg-background text-sm text-on-surface py-1.5 md:py-2.5 pl-2.5 md:pl-3 pr-6 md:pr-8 font-medium focus:outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer shrink-0"
        >
          <option value="">All Teams</option>
          {teamOptions.map((team) => (
            <option key={team.id} value={team.id}>{team.name}</option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="appearance-none rounded-xl border border-outline-variant bg-background text-sm text-on-surface py-1.5 md:py-2.5 pl-2.5 md:pl-3 pr-6 md:pr-8 font-medium focus:outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer shrink-0"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="inline-flex items-center gap-1.5 rounded-xl border border-outline-variant bg-background text-secondary px-2.5 md:px-3 py-1.5 md:py-2.5 text-sm font-medium hover:bg-surface-container-high transition-colors shrink-0"
          >
            <XIcon className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Clear</span>
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 overflow-hidden">
        {isLoading && cursor === null ? (
          <TableSkeleton />
        ) : (
          <>
            {/* Mobile: card layout */}
            <div className="md:hidden space-y-3">
              {accumulated.length > 0 ? accumulated.map((meeting) => (
                <Link
                  key={`${meeting.id}-${cursor ?? "0"}`}
                  href={meeting.capabilities.canOpenLiveRoom ? `/meetings/${meeting.id}/live` : `/meetings/${meeting.id}`}
                  className="block bg-surface-container-lowest rounded-2xl border border-outline-variant/20 p-4 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <p className="font-semibold text-on-surface text-sm leading-snug line-clamp-1">{meeting.title}</p>
                    <StatusBadge status={meeting.status} />
                  </div>
                  <div className="grid grid-cols-2 gap-y-1.5 text-xs text-secondary">
                    {meeting.scheduledAt ? (
                      <span>{formatDateTime(meeting.scheduledAt, data?.timezone || "UTC")}</span>
                    ) : (
                      <span className="text-secondary/50">Not scheduled</span>
                    )}
                    <span className="text-right"><KindBadge kind={meeting.kind} /></span>
                    <span className="inline-flex items-center rounded-md bg-surface-container-high px-1.5 py-0.5 font-medium">
                      {meeting.ownerTeam.name}
                    </span>
                    <span className="text-right text-on-surface">{meeting.organizer.name}</span>
                    <span className="text-secondary">{formatDuration(meeting.plannedDurationSeconds)}</span>
                    <span className="text-right">
                      {meeting.status === "IN_PROGRESS" && meeting.capabilities.canOpenLiveRoom && (
                        <span className="text-xs font-semibold text-primary">Open Live Room</span>
                      )}
                    </span>
                  </div>
                </Link>
              )) : (
                <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 py-16 text-center">
                  <div className="w-12 h-12 rounded-full bg-surface-container-high flex items-center justify-center mx-auto">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6 text-secondary/40">
                      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>
                  </div>
                  <p className="text-secondary text-sm mt-3">No meetings found</p>
                </div>
              )}
            </div>

            {/* Desktop: table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-outline-variant/20 bg-surface-container/30">
                  <th className="text-left py-3 px-5 text-[11px] font-bold text-secondary uppercase tracking-wider">Meeting Title</th>
                  <th className="text-left py-3 px-5 text-[11px] font-bold text-secondary uppercase tracking-wider">Status</th>
                  <th className="text-left py-3 px-5 text-[11px] font-bold text-secondary uppercase tracking-wider">Date/Time</th>
                  <th className="text-left py-3 px-5 text-[11px] font-bold text-secondary uppercase tracking-wider">Team</th>
                  <th className="text-left py-3 px-5 text-[11px] font-bold text-secondary uppercase tracking-wider">Organizer</th>
                  <th className="text-left py-3 px-5 text-[11px] font-bold text-secondary uppercase tracking-wider">Kind</th>
                  <th className="text-left py-3 px-5 text-[11px] font-bold text-secondary uppercase tracking-wider">Duration</th>
                  <th className="py-3 px-5" />
                </tr>
              </thead>
              <tbody>
                {isError ? (
                  <ErrorState />
                ) : accumulated.length > 0 ? (
                  accumulated.map((meeting) => (
                    <tr key={`${meeting.id}-${cursor ?? "0"}`} className="border-b border-outline-variant/10 last:border-0 hover:bg-surface-container/20 transition-colors">
                      <td className="py-3 px-5">
                        <Link href={`/meetings/${meeting.id}`} className="font-medium text-on-surface hover:text-primary transition-colors">
                          {meeting.title}
                        </Link>
                      </td>
                      <td className="py-3 px-5"><StatusBadge status={meeting.status} /></td>
                      <td className="py-3 px-5">
                        {meeting.scheduledAt ? (
                          <span className="text-sm text-on-surface">{formatDateTime(meeting.scheduledAt, data?.timezone || "UTC")}</span>
                        ) : (
                          <span className="text-sm text-secondary/50">Not set</span>
                        )}
                      </td>
                      <td className="py-3 px-5">
                        <span className="inline-flex items-center rounded-md bg-surface-container-high px-2 py-0.5 text-xs font-medium text-secondary">
                          {meeting.ownerTeam.name}
                        </span>
                      </td>
                      <td className="py-3 px-5">
                        <span className="text-sm text-on-surface">{meeting.organizer.name}</span>
                      </td>
                      <td className="py-3 px-5"><KindBadge kind={meeting.kind} /></td>
                      <td className="py-3 px-5">
                        <span className="text-sm text-secondary">{formatDuration(meeting.plannedDurationSeconds)}</span>
                      </td>
                      <td className="py-3 px-5">
                        <RowAction meeting={meeting} />
                      </td>
                    </tr>
                  ))
                ) : (
                  <ZeroState />
                )}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>

      {/* Pagination */}
      {data && accumulated.length > 0 && (
        <div className="flex items-center justify-between bg-surface-container-lowest rounded-2xl border border-outline-variant/20 px-5 py-3">
          <p className="text-sm text-secondary">
            Showing {accumulated.length} of {data.totalVisible} meetings
          </p>
          <div className="flex items-center gap-1">
            {data.nextCursor && (
              <button
                onClick={handleLoadMore}
                disabled={isLoading}
                className="inline-flex items-center gap-1 rounded-xl bg-surface-container-high text-on-surface px-4 py-2 text-sm font-semibold hover:bg-surface-container transition-colors disabled:opacity-50"
              >
                {isLoading ? "Loading..." : "Load more"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

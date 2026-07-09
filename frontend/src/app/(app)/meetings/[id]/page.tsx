"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useMeeting, useAddAttendee, useRemoveAttendee, useCancelMeeting, useOverrideSchedule } from "@/lib/api/queries/meetings";
import { useUsers } from "@/lib/api/queries/users";
import { useCurrentUser } from "@/lib/api/queries/auth";
import { XIcon, ArrowBackIcon, ArrowForwardIcon, GroupAddIcon, CancelIcon, EditCalendarIcon, LocationOnIcon, PlayCircleIcon } from "@/components/icons";
import type { MeetingAttendee } from "@/types/api";

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

const avatarColors = ["bg-primary", "bg-tertiary", "bg-secondary"];

function formatDuration(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${m} min`;
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  SCHEDULED: "Scheduled",
  IN_PROGRESS: "Live",
  ENDED_PENDING_SUMMARY: "Summary Pending",
  COMPLETED_LOCKED: "Completed",
  CANCELLED: "Cancelled",
};

const STATUS_CONFIG: Record<string, { classes: string; pulse?: boolean }> = {
  DRAFT: { classes: "bg-surface-container-high text-secondary/60" },
  SCHEDULED: { classes: "bg-tertiary-fixed/60 text-tertiary" },
  IN_PROGRESS: { classes: "bg-primary/10 text-primary", pulse: true },
  ENDED_PENDING_SUMMARY: { classes: "bg-surface-variant text-on-surface-variant" },
  COMPLETED_LOCKED: { classes: "bg-secondary-container/60 text-secondary" },
  CANCELLED: { classes: "bg-error/10 text-error" },
};

function StatusBadge({ status }: { status: string }) {
  const label = STATUS_LABEL[status] || status;
  const { classes, pulse } = STATUS_CONFIG[status] || { classes: "bg-surface-variant text-on-surface-variant" };
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold", classes)}>
      {pulse && <span className="w-2 h-2 rounded-full bg-error animate-pulse" />}
      {label}
    </span>
  );
}

function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-surface-container-low rounded-xl p-6 w-full max-w-lg shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-headline text-lg font-semibold text-on-surface">{title}</h2>
          <button onClick={onClose} className="text-secondary hover:text-on-surface transition-colors">
            <XIcon className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function AttendeeManager({ meetingId, attendees, ownerTeamId, currentUserId, onClose }: { meetingId: string; attendees: MeetingAttendee[]; ownerTeamId: string; currentUserId?: string; onClose: () => void }) {
  const { data: allUsers } = useUsers();
  const addAttendee = useAddAttendee();
  const removeAttendee = useRemoveAttendee();

  const activeAttendees = attendees.filter((a) => !a.removedAt);
  const teamUsers = allUsers?.filter((u) => u.functionalTeamId === ownerTeamId && u.isActive) ?? [];
  const availableToAdd = teamUsers.filter((u) => !activeAttendees.some((a) => a.userId === u.id));

  const [selectedUserId, setSelectedUserId] = useState("");

  const handleAdd = async () => {
    if (!selectedUserId) return;
    await addAttendee.mutateAsync({ meetingId, userId: selectedUserId });
    setSelectedUserId("");
  };

  const handleRemove = async (userId: string) => {
    await removeAttendee.mutateAsync({ meetingId, userId });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2 max-h-60 overflow-y-auto">
        {activeAttendees.length === 0 && <p className="text-sm text-secondary">No active participants</p>}
        {activeAttendees.map((a) => (
          <div key={a.id} className="flex items-center justify-between p-2 rounded-lg hover:bg-surface-container-high transition-colors">
            <div className="flex items-center gap-3">
              <div className={cn("w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0", avatarColors[Math.abs(a.userId.charCodeAt(0)) % avatarColors.length])}>
                {a.user ? getInitials(a.user.name) : "?"}
              </div>
              <div>
                <p className="text-sm font-medium text-on-surface">{a.user?.name ?? "—"}</p>
                <p className="text-xs text-secondary">{a.user?.operationalRole ?? ""}</p>
              </div>
            </div>
            {a.userId !== currentUserId && (
              <button onClick={() => handleRemove(a.userId)} disabled={removeAttendee.isPending} className="text-xs text-error hover:underline disabled:opacity-50">
                Remove
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="border-t border-outline-variant/30 pt-3 space-y-2">
        <p className="text-xs text-secondary uppercase tracking-wider font-semibold">Add Participant</p>
        <div className="flex gap-2">
          <select
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value)}
            className="flex-1 rounded-lg border border-outline-variant bg-surface-container-high px-3 py-2 text-sm text-on-surface"
          >
            <option value="">Select a team member...</option>
            {availableToAdd.map((u) => (
              <option key={u.id} value={u.id}>{u.name} ({u.operationalRole})</option>
            ))}
          </select>
          <button
            onClick={handleAdd}
            disabled={!selectedUserId || addAttendee.isPending}
            className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:brightness-110 transition-all disabled:opacity-50"
          >
            Add
          </button>
        </div>
        <p className="text-xs text-secondary/60 italic">Cross-Team invitations are handled separately</p>
      </div>
    </div>
  );
}

function CancelMeetingDialog({ meeting, onClose }: { meeting: any; onClose: () => void }) {
  const cancelMeeting = useCancelMeeting();
  const [disposition, setDisposition] = useState<"RETURN_TO_PLANNING" | "CANCEL_REQUEST" | "">("");
  const hasER = !!meeting.executiveRequest;

  const handleCancel = async () => {
    await cancelMeeting.mutateAsync({
      id: meeting.id,
      ...(hasER ? { executiveRequestDisposition: disposition as "RETURN_TO_PLANNING" | "CANCEL_REQUEST" } : {}),
    });
    onClose();
  };

  return (
    <div className="space-y-4">
      <div className="bg-error/5 rounded-lg p-4 text-sm text-on-surface">
        <p className="font-semibold text-error">Are you sure you want to cancel this meeting?</p>
        <p className="mt-1 text-secondary">This action cannot be undone. All participants will be notified.</p>
      </div>
      {hasER && (
        <div className="space-y-2">
          <p className="text-xs text-secondary uppercase tracking-wider font-semibold">Executive Request Disposition</p>
          <select
            value={disposition}
            onChange={(e) => setDisposition(e.target.value as any)}
            className="w-full rounded-lg border border-outline-variant bg-surface-container-high px-3 py-2 text-sm text-on-surface"
          >
            <option value="">Select disposition...</option>
            <option value="RETURN_TO_PLANNING">Return to Planning</option>
            <option value="CANCEL_REQUEST">Cancel Request</option>
          </select>
        </div>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-secondary hover:bg-surface-container-high transition-colors">
          Keep Meeting
        </button>
        <button
          onClick={handleCancel}
          disabled={cancelMeeting.isPending || (hasER && !disposition)}
          className="px-4 py-2 rounded-lg bg-error text-error-foreground text-sm font-medium hover:brightness-110 transition-all disabled:opacity-50"
        >
          {cancelMeeting.isPending ? "Cancelling..." : "Confirm Cancellation"}
        </button>
      </div>
    </div>
  );
}

function OverrideScheduleForm({ meeting, onClose }: { meeting: any; onClose: () => void }) {
  const override = useOverrideSchedule();

  const toLocalDate = (iso: string | null) => {
    if (!iso) return "";
    return new Date(iso).toISOString().slice(0, 10);
  };
  const toLocalTime = (iso: string | null) => {
    if (!iso) return "";
    return new Date(iso).toISOString().slice(11, 16);
  };

  const [date, setDate] = useState(toLocalDate(meeting.scheduledAt));
  const [time, setTime] = useState(toLocalTime(meeting.scheduledAt));
  const [plannedDurationMinutes, setPlannedDurationMinutes] = useState((meeting.plannedDurationSeconds / 60)?.toString() ?? "30");
  const [locationType, setLocationType] = useState(meeting.locationType ?? "PHYSICAL");
  const [roomId, setRoomId] = useState(meeting.roomId ?? "");
  const [onlineLink, setOnlineLink] = useState(meeting.onlineLink ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    setError("");
    if (!reason.trim()) { setError("A reason is required"); return; }

    const payload: any = { reason: reason.trim() };
    if (date && time) {
      const newScheduledAt = new Date(`${date}T${time}:00`).toISOString();
      if (newScheduledAt !== meeting.scheduledAt) payload.scheduledAt = newScheduledAt;
    }
    const newDurationMinutes = parseInt(plannedDurationMinutes, 10);
    if (!isNaN(newDurationMinutes) && newDurationMinutes > 0) {
      const newDurationSeconds = newDurationMinutes * 60;
      if (newDurationSeconds !== meeting.plannedDurationSeconds) payload.plannedDurationSeconds = newDurationSeconds;
    }
    if (locationType !== meeting.locationType) payload.locationType = locationType;
    const newRoomId = roomId || null;
    if (newRoomId !== (meeting.roomId ?? null)) payload.roomId = newRoomId;
    const newOnlineLink = onlineLink || null;
    if (newOnlineLink !== (meeting.onlineLink ?? null)) payload.onlineLink = newOnlineLink;

    if (!payload.scheduledAt && !payload.plannedDurationSeconds && !payload.locationType && payload.roomId === undefined && payload.onlineLink === undefined) {
      setError("At least one field must change");
      return;
    }

    try {
      await override.mutateAsync({ id: meeting.id, data: payload });
      onClose();
    } catch (e: any) {
      setError(e instanceof Error ? e.message : "Failed to override schedule");
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-xs text-secondary uppercase tracking-wider font-semibold mb-1">Date</p>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-lg border border-outline-variant bg-surface-container-high px-3 py-2 text-sm text-on-surface"
            />
          </div>
          <div>
            <p className="text-xs text-secondary uppercase tracking-wider font-semibold mb-1">Time</p>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="w-full rounded-lg border border-outline-variant bg-surface-container-high px-3 py-2 text-sm text-on-surface"
            />
          </div>
        </div>
        <div>
          <p className="text-xs text-secondary uppercase tracking-wider font-semibold mb-1">Duration (minutes)</p>
          <input
            type="number"
            min={1}
            value={plannedDurationMinutes}
            onChange={(e) => setPlannedDurationMinutes(e.target.value)}
            className="w-full rounded-lg border border-outline-variant bg-surface-container-high px-3 py-2 text-sm text-on-surface"
          />
        </div>
        <div>
          <p className="text-xs text-secondary uppercase tracking-wider font-semibold mb-1">Location Type</p>
          <select
            value={locationType}
            onChange={(e) => setLocationType(e.target.value)}
            className="w-full rounded-lg border border-outline-variant bg-surface-container-high px-3 py-2 text-sm text-on-surface"
          >
            <option value="PHYSICAL">Physical</option>
            <option value="ONLINE">Online</option>
            <option value="HYBRID">Hybrid</option>
          </select>
        </div>
        {locationType !== "ONLINE" && (
          <div>
            <p className="text-xs text-secondary uppercase tracking-wider font-semibold mb-1">Room ID</p>
            <input
              type="text"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              placeholder="Room ID"
              className="w-full rounded-lg border border-outline-variant bg-surface-container-high px-3 py-2 text-sm text-on-surface"
            />
          </div>
        )}
        {locationType !== "PHYSICAL" && (
          <div>
            <p className="text-xs text-secondary uppercase tracking-wider font-semibold mb-1">Online Link</p>
            <input
              type="url"
              value={onlineLink}
              onChange={(e) => setOnlineLink(e.target.value)}
              placeholder="https://..."
              className="w-full rounded-lg border border-outline-variant bg-surface-container-high px-3 py-2 text-sm text-on-surface"
            />
          </div>
        )}
        <div>
          <p className="text-xs text-secondary uppercase tracking-wider font-semibold mb-1">Reason *</p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="Explain why the override is needed"
            className="w-full rounded-lg border border-outline-variant bg-surface-container-high px-3 py-2 text-sm text-on-surface resize-none"
          />
        </div>
      </div>
      {error && <p className="text-sm text-error">{error}</p>}
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-secondary hover:bg-surface-container-high transition-colors">
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={override.isPending}
          className="px-4 py-2 rounded-lg bg-secondary text-secondary-foreground text-sm font-medium hover:brightness-110 transition-all disabled:opacity-50"
        >
          {override.isPending ? "Saving..." : "Apply Override"}
        </button>
      </div>
    </div>
  );
}

export default function MeetingDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const { data: meeting, isLoading } = useMeeting(id);
  const { data: currentUser } = useCurrentUser();

  const [showAttendeeManager, setShowAttendeeManager] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showOverrideForm, setShowOverrideForm] = useState(false);

  if (isLoading) {
    return (
      <div className="p-12 text-center text-secondary">Loading meeting...</div>
    );
  }

  if (!meeting) {
    return (
      <div className="p-12 text-center">
        <p className="text-secondary">Meeting not found</p>
        <Link href="/meetings" className="text-primary hover:underline mt-2 inline-block">
          Back to Meetings
        </Link>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 overflow-x-hidden">
      <Link
        href="/meetings"
        className="flex items-center gap-1 text-sm text-secondary hover:text-primary transition-colors w-fit"
      >
        <ArrowBackIcon className="h-4 w-4" />
        Back to Meetings
      </Link>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-headline text-3xl font-semibold text-on-surface">
            {meeting.title}
          </h1>
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <StatusBadge status={meeting.status} />
            {meeting.scheduledAt && (
              <>
                <span className="text-sm text-secondary">{new Date(meeting.scheduledAt).toLocaleDateString()}</span>
                <span className="text-sm text-secondary">{new Date(meeting.scheduledAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              </>
            )}
            <span className="text-xs text-secondary bg-surface-container-high px-2 py-0.5 rounded-md">
              ({formatDuration(meeting.plannedDurationSeconds)})
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {meeting.capabilities.canOpenLiveRoom && (
            <Link
              href={`/meetings/${id}/live`}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:brightness-110 transition-all"
            >
              Open Live Room
              <ArrowForwardIcon className="h-4 w-4" />
            </Link>
          )}
          {meeting.capabilities.canViewMeetingSummary && (
            <Link
              href={`/meetings/${id}/live`}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:brightness-110 transition-all"
            >
              View Meeting Summary
              <ArrowForwardIcon className="h-4 w-4" />
            </Link>
          )}
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {meeting.capabilities.canManageAttendees && (
          <button onClick={() => setShowAttendeeManager(true)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-surface-container-high text-secondary text-xs font-medium hover:bg-surface-variant transition-colors">
            <GroupAddIcon className="h-4 w-4" />
            Manage Participants
          </button>
        )}
        {meeting.capabilities.canCancel && (
          <button onClick={() => setShowCancelDialog(true)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-error/10 text-error text-xs font-medium hover:bg-error/20 transition-colors">
            <CancelIcon className="h-4 w-4" />
            Cancel Meeting
          </button>
        )}
        {meeting.capabilities.canOverrideSchedule && (
          <button onClick={() => setShowOverrideForm(true)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-surface-container-high text-secondary text-xs font-medium hover:bg-surface-variant transition-colors">
            <EditCalendarIcon className="h-4 w-4" />
            Override Schedule
          </button>
        )}
      </div>

      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-4 space-y-6">
          <div className="bg-surface-container-low rounded-xl p-5 space-y-4">
            <h2 className="font-headline text-lg font-semibold text-on-surface">Overview</h2>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-secondary uppercase tracking-wider font-semibold mb-1">Organizer</p>
                <p className="text-sm font-medium text-on-surface">{meeting.organizer?.name ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-secondary uppercase tracking-wider font-semibold mb-1">Team</p>
                <p className="text-sm text-on-surface">{meeting.ownerTeam?.name ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-secondary uppercase tracking-wider font-semibold mb-1">Location</p>
                <p className="flex items-center gap-1.5 text-sm text-on-surface">
                  <LocationOnIcon className="h-4 w-4 text-secondary" />
                  {meeting.locationType === "ONLINE"
                    ? meeting.onlineLink
                    : meeting.locationType === "HYBRID"
                    ? `${meeting.room?.name ?? ""} + ${meeting.onlineLink ?? ""}`
                    : meeting.room?.name ?? "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-secondary uppercase tracking-wider font-semibold mb-2">Meeting Kind</p>
                <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-surface-container-high text-secondary">
                  {meeting.kind === "STRUCTURED" ? "Structured" : "Quick Team"}
                </span>
              </div>
              {meeting.organizerSummary && (
                <div>
                  <p className="text-xs text-secondary uppercase tracking-wider font-semibold mb-1">Summary</p>
                  <p className="text-sm text-on-surface">{meeting.organizerSummary}</p>
                </div>
              )}
            </div>
          </div>

          <div className="bg-surface-container-low rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-headline text-lg font-semibold text-on-surface">Participants</h2>
              <span className="text-xs font-medium bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                {meeting.attendees?.filter((a) => !a.removedAt).length ?? 0} Members
              </span>
            </div>
            <div className="space-y-2">
              {meeting.attendees && meeting.attendees.length > 0 ? (
                meeting.attendees
                  .filter((a) => !a.removedAt)
                  .map((attendee) => (
                    <div
                      key={attendee.id}
                      className="flex items-center justify-between group p-2 rounded-lg hover:bg-surface-container-high transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0",
                          avatarColors[Math.abs(attendee.userId.charCodeAt(0)) % avatarColors.length]
                        )}>
                          {attendee.user ? getInitials(attendee.user.name) : "?"}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-on-surface">{attendee.user?.name ?? "—"}</p>
                          <p className="text-xs text-secondary">{attendee.user?.operationalRole ?? ""}</p>
                        </div>
                      </div>
                    </div>
                  ))
              ) : (
                <p className="text-sm text-secondary">No attendees</p>
              )}
            </div>
          </div>
        </div>

        <div className="col-span-8 space-y-6">
          <div className="bg-surface-container-low rounded-xl p-5 space-y-4">
            <h2 className="font-headline text-lg font-semibold text-on-surface">
              Agenda
              <span className="text-sm font-normal text-secondary ml-2">({meeting.agendaItems?.length ?? 0} items)</span>
            </h2>
            <div className="relative pl-8 space-y-6">
              {meeting.agendaItems && meeting.agendaItems.length > 0 ? (
                <>
                  <div className="absolute left-[11px] top-2 bottom-2 w-0.5 bg-outline-variant/50" />
                  {[...meeting.agendaItems]
                    .sort((a, b) => a.sortOrder - b.sortOrder)
                    .map((item, i) => (
                      <div key={item.id} className="relative">
                        <div
                          className={cn(
                            "absolute -left-[23px] top-1 w-[18px] h-[18px] rounded-full border-2 border-surface-container-low z-10",
                            item.status === "COMPLETED"
                              ? "bg-primary"
                              : item.status === "IN_PROGRESS"
                              ? "bg-tertiary"
                              : "bg-surface-container-high"
                          )}
                        />
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <p className={cn(
                              "text-sm font-semibold",
                              item.status === "SKIPPED" ? "text-secondary line-through" : "text-on-surface"
                            )}>
                              {item.title}
                            </p>
                            <span className="text-xs text-secondary bg-surface-container-high px-2 py-0.5 rounded-md">
                              {formatDuration(item.durationSeconds)}
                            </span>
                            {item.status === "SKIPPED" && (
                              <span className="text-[10px] font-bold text-secondary/60 uppercase">Skipped</span>
                            )}
                          </div>
                          {item.description && (
                            <p className="text-xs text-secondary leading-relaxed">{item.description}</p>
                          )}
                          {item.speakers && item.speakers.length > 0 && (
                            <p className="text-xs text-secondary/70">
                              Speaker{item.speakers.length > 1 ? "s" : ""}: {item.speakers.map((s) => s.user?.name).filter(Boolean).join(", ")}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                </>
              ) : (
                <p className="text-sm text-secondary">No agenda items</p>
              )}
            </div>
          </div>

          {meeting.executiveRequest && meeting.capabilities.canViewLinkedExecutiveRequest && (
            <Link
              href={`/executive-requests/${meeting.executiveRequest.id}`}
              className="block bg-surface-container-low rounded-xl p-5 space-y-2 border border-outline-variant/20 hover:bg-surface-container-high transition-colors"
            >
              <p className="text-xs text-secondary uppercase tracking-wider font-semibold">Linked Executive Request</p>
              <p className="text-sm font-medium text-on-surface">{meeting.executiveRequest.title}</p>
              <span className="inline-flex items-center gap-1 text-xs text-primary">
                View details
                <ArrowForwardIcon className="h-3 w-3" />
              </span>
            </Link>
          )}

          {meeting.status === "SCHEDULED" && meeting.capabilities.canOpenLiveRoom && (
            <Link
              href={`/meetings/${id}/live`}
              className="block bg-primary rounded-xl p-6 text-primary-foreground relative overflow-hidden group hover:brightness-110 transition-all"
            >
              <div className="relative z-10 flex items-center justify-between">
                <div className="space-y-2">
                  <h3 className="font-headline text-lg font-semibold">Ready to start?</h3>
                  <p className="text-sm text-primary-foreground/80">Enter the live meeting environment</p>
                  <span className="inline-flex items-center gap-2 mt-2 text-sm font-semibold bg-primary-foreground/20 px-4 py-2 rounded-lg group-hover:bg-primary-foreground/30 transition-colors">
                    Open Live Room
                    <ArrowForwardIcon className="h-4 w-4" />
                  </span>
                </div>
                <PlayCircleIcon className="h-16 w-16 text-primary-foreground/20" />
              </div>
            </Link>
          )}
        </div>
      </div>

      <Modal open={showAttendeeManager} onClose={() => setShowAttendeeManager(false)} title="Manage Participants">
        <AttendeeManager
          meetingId={meeting.id}
          attendees={meeting.attendees ?? []}
          ownerTeamId={meeting.ownerTeamId}
          currentUserId={currentUser?.id}
          onClose={() => setShowAttendeeManager(false)}
        />
      </Modal>

      <Modal open={showCancelDialog} onClose={() => setShowCancelDialog(false)} title="Cancel Meeting">
        <CancelMeetingDialog meeting={meeting} onClose={() => setShowCancelDialog(false)} />
      </Modal>

      <Modal open={showOverrideForm} onClose={() => setShowOverrideForm(false)} title="Override Schedule">
        <OverrideScheduleForm meeting={meeting} onClose={() => setShowOverrideForm(false)} />
      </Modal>
    </div>
  );
}
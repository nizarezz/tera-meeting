"use client";

import { useState } from "react";
import { useCurrentUser } from "@/lib/api/queries/auth";
import { useTeams } from "@/lib/api/queries/teams";
import { useUsers } from "@/lib/api/queries/users";
import { useBrowseMeetings } from "@/lib/api/queries/meetings";
import {
  useMyTeamParkingLotItems,
  useTeamParkingLotItems,
  useCreateParkingLotItem,
  useApproveParkingLotItem,
  useArchiveParkingLotItem,
  useAddToAgenda,
} from "@/lib/api/queries/parking-lot";
import { ApiError } from "@/lib/api/client";
import { AddIcon, LocalParkingIcon } from "@/components/icons";
import type { ParkingLotItem, ParkingLotStatus } from "@/types/api";

const STATUS_TABS: { key: ParkingLotStatus | "ALL"; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "PENDING_REVIEW", label: "Pending Review" },
  { key: "APPROVED", label: "Approved" },
  { key: "USED_IN_AGENDA", label: "Used" },
  { key: "ARCHIVED", label: "Archived" },
];

const STATUS_COLORS: Record<ParkingLotStatus, string> = {
  PENDING_REVIEW: "bg-tertiary/15 text-tertiary",
  APPROVED: "bg-primary/15 text-primary",
  USED_IN_AGENDA: "bg-secondary-container text-secondary",
  ARCHIVED: "bg-surface-container-high text-secondary/60",
};

export default function ParkingLotPage() {
  const { data: user } = useCurrentUser();
  const { data: teams } = useTeams();
  const { data: allUsers } = useUsers();
  const [activeTab, setActiveTab] = useState<ParkingLotStatus | "ALL">("ALL");
  const [showCreate, setShowCreate] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [createNote, setCreateNote] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [agendaItemId, setAgendaItemId] = useState<string | null>(null);

  const isSecretary = user?.operationalRole === "SECRETARY";
  const isAdmin = isSecretary || user?.operationalRole === "TEAM_ADMIN";
  const myTeamId = user?.functionalTeamId;

  const { data: myItems } = useMyTeamParkingLotItems();
  const { data: teamItems } = useTeamParkingLotItems(myTeamId || "");
  const items = isSecretary ? myItems : teamItems;

  const { data: meetingData } = useBrowseMeetings({
    kinds: "STRUCTURED",
    statuses: "DRAFT,SCHEDULED",
    sort: "RECENT",
    limit: "50",
  });

  const eligibleMeetings = meetingData?.items || [];

  const createMut = useCreateParkingLotItem();
  const approveMut = useApproveParkingLotItem();
  const archiveMut = useArchiveParkingLotItem();
  const addToAgendaMut = useAddToAgenda();

  const filteredItems = items?.filter((item) => activeTab === "ALL" || item.status === activeTab) || [];

  const handleCreate = async () => {
    if (!createTitle.trim() || !myTeamId) return;
    setCreateError(null);
    try {
      await createMut.mutateAsync({ teamId: myTeamId, title: createTitle.trim(), note: createNote.trim() || undefined });
      setShowCreate(false);
      setCreateTitle("");
      setCreateNote("");
    } catch (e) {
      setCreateError(e instanceof ApiError ? e.message : "Failed to create item");
    }
  };

  const handleApprove = async (id: string) => {
    try { await approveMut.mutateAsync(id); } catch {}
  };

  const handleArchive = async (id: string) => {
    try { await archiveMut.mutateAsync(id); } catch {}
  };

  const handleAddToAgenda = async (meetingId: string) => {
    if (!agendaItemId) return;
    try {
      await addToAgendaMut.mutateAsync({ id: agendaItemId, agendaMeetingId: meetingId });
      setAgendaItemId(null);
    } catch {}
  };

  const getCreatorName = (item: ParkingLotItem) => {
    if (item.createdBy) return item.createdBy.name;
    const u = allUsers?.find((u) => u.id === item.createdById);
    return u?.name || "Unknown";
  };

  return (
    <div className="p-4 md:p-6 space-y-6 overflow-x-hidden">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-headline text-3xl font-bold text-on-surface">Parking Lot</h1>
          <p className="text-secondary text-sm mt-1">Items queued for future meeting agendas</p>
        </div>
        {myTeamId && (
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-5 py-2.5 text-sm font-semibold hover:brightness-110 active:scale-[0.98] transition-all"
          >
            <AddIcon className="h-4 w-4" />
            New Item
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 bg-surface-container-lowest rounded-2xl border border-outline-variant/20 p-2 overflow-x-auto max-w-full">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`rounded-xl text-sm font-semibold whitespace-nowrap shrink-0 px-3 py-1.5 md:px-4 md:py-2 transition-all ${
              activeTab === tab.key
                ? "bg-primary text-primary-foreground"
                : "border border-outline-variant bg-background text-on-surface hover:bg-surface-container-high"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

        {filteredItems.length === 0 ? (
          <div className="text-center py-16">
            <LocalParkingIcon className="h-12 w-12 text-secondary/30" />
            <p className="text-secondary mt-3 text-sm">No items in this category</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredItems.map((item) => (
              <div key={item.id} className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-on-surface">{item.title}</h3>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${STATUS_COLORS[item.status]}`}>
                        {item.status.replace(/_/g, " ")}
                      </span>
                    </div>
                    {item.note && <p className="text-sm text-secondary mt-1">{item.note}</p>}
                    <div className="flex items-center gap-4 mt-2 text-xs text-secondary">
                      <span>By {getCreatorName(item)}</span>
                      {item.sourceMeeting && <span>From: {item.sourceMeeting.title}</span>}
                      {item.agendaMeeting && <span>Used in: {item.agendaMeeting.title}</span>}
                    </div>
                  </div>
                  {isAdmin && item.status === "PENDING_REVIEW" && (
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => handleApprove(item.id)}
                        disabled={approveMut.isPending}
                        className="px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-bold hover:bg-primary/20 transition-all"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleArchive(item.id)}
                        disabled={archiveMut.isPending}
                        className="px-3 py-1.5 rounded-lg bg-error/10 text-error text-xs font-bold hover:bg-error/20 transition-all"
                      >
                        Archive
                      </button>
                    </div>
                  )}
                  {isAdmin && item.status === "APPROVED" && !item.agendaMeetingId && (
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => setAgendaItemId(item.id)}
                        className="px-3 py-1.5 rounded-lg bg-secondary-container text-secondary text-xs font-bold hover:bg-secondary-container/80 transition-all"
                      >
                        Add to agenda
                      </button>
                      <button
                        onClick={() => handleArchive(item.id)}
                        disabled={archiveMut.isPending}
                        className="px-3 py-1.5 rounded-lg bg-error/10 text-error text-xs font-bold hover:bg-error/20 transition-all"
                      >
                        Archive
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {showCreate && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowCreate(false)}>
            <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
              <h2 className="font-headline text-lg font-bold text-on-surface mb-4">New Parking Lot Item</h2>
              {createError && <p className="text-error text-sm mb-3">{createError}</p>}
              <input
                type="text"
                placeholder="Item title"
                value={createTitle}
                onChange={(e) => setCreateTitle(e.target.value)}
                className="w-full border border-outline-variant/40 rounded-lg px-4 py-2.5 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-primary/30"
                autoFocus
              />
              <textarea
                placeholder="Note (optional)"
                value={createNote}
                onChange={(e) => setCreateNote(e.target.value)}
                rows={3}
                className="w-full border border-outline-variant/40 rounded-lg px-4 py-2.5 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <div className="flex justify-end gap-3">
                <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-secondary hover:text-primary transition-all">
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  disabled={!createTitle.trim() || createMut.isPending}
                  className="px-5 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-bold hover:brightness-110 disabled:opacity-50 transition-all"
                >
                  {createMut.isPending ? "Creating..." : "Create"}
                </button>
              </div>
            </div>
          </div>
        )}

        {agendaItemId && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setAgendaItemId(null)}>
            <div className="bg-surface rounded-2xl shadow-xl w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
              <h2 className="font-headline text-lg font-bold text-on-surface mb-1">Add to Meeting Agenda</h2>
              <p className="text-sm text-secondary mb-4">Select a Structured meeting in Draft or Scheduled status</p>
              {addToAgendaMut.isError && (
                <p className="text-error text-sm mb-3">
                  {addToAgendaMut.error instanceof ApiError ? addToAgendaMut.error.message : "Failed to add to agenda"}
                </p>
              )}
              {eligibleMeetings.length === 0 ? (
                <p className="text-secondary text-sm py-4">No eligible meetings available</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto mb-4">
                  {eligibleMeetings.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => handleAddToAgenda(m.id)}
                      disabled={addToAgendaMut.isPending}
                      className="w-full text-left px-4 py-3 rounded-lg border border-outline-variant/30 hover:bg-surface-container-high transition-all"
                    >
                      <div className="font-semibold text-sm text-on-surface">{m.title}</div>
                      <div className="text-xs text-secondary mt-0.5">
                        {m.status} &middot; {m.ownerTeam.name} &middot; {m.scheduledAt ? new Date(m.scheduledAt).toLocaleDateString() : "No date"}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              <div className="flex justify-end">
                <button onClick={() => setAgendaItemId(null)} className="px-4 py-2 text-sm text-secondary hover:text-primary transition-all">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

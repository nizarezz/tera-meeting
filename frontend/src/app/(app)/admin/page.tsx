"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { useTeams, useCreateTeam, useUpdateTeam, useDeleteTeam } from "@/lib/api/queries/teams";
import { useUsers, useCreateUser, useUpdateUser } from "@/lib/api/queries/users";
import { useRooms, useCreateRoom, useUpdateRoom, useDeleteRoom } from "@/lib/api/queries/rooms";
import { useCurrentUser } from "@/lib/api/queries/auth";
import { GroupsIcon, PersonIcon, MeetingRoomIcon, PlusIcon, XIcon } from "@/components/icons";
import type { SVGProps } from "react";

function getInitials(name: string): string {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

const tabs = ["Teams", "People", "Rooms"];

function Modal({ open, onClose, children, title }: { open: boolean; onClose: () => void; children: React.ReactNode; title: string }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 w-full max-w-lg mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 pt-6 pb-2">
          <h2 className="font-headline text-lg font-bold text-on-surface">{title}</h2>
          <button onClick={onClose} className="text-secondary hover:text-on-surface transition-colors p-1"><XIcon className="h-5 w-5" /></button>
        </div>
        <div className="px-6 pb-6">{children}</div>
      </div>
    </div>
  );
}

function ConfirmDialog({ open, onClose, onConfirm, title, message }: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; message: string }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 w-full max-w-sm mx-4 shadow-xl p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-headline text-lg font-bold text-on-surface mb-2">{title}</h3>
        <p className="text-sm text-secondary mb-6">{message}</p>
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-semibold text-secondary hover:text-on-surface bg-surface-container-high hover:bg-surface-container-higher transition-colors">Cancel</button>
          <button onClick={() => { onConfirm(); onClose(); }} className="px-4 py-2 rounded-xl text-sm font-semibold text-primary-foreground bg-error hover:brightness-110 transition-all">Confirm</button>
        </div>
      </div>
    </div>
  );
}

export default function AdminPage() {
  const { data: user } = useCurrentUser();
  const isSecretary = user?.operationalRole === "SECRETARY";
  const [activeTab, setActiveTab] = useState(0);
  const { data: teams, isLoading: teamsLoading } = useTeams();
  const { data: users, isLoading: usersLoading } = useUsers();
  const { data: rooms, isLoading: roomsLoading } = useRooms();
  const createTeam = useCreateTeam();
  const updateTeam = useUpdateTeam();
  const deleteTeam = useDeleteTeam();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const createRoom = useCreateRoom();
  const updateRoom = useUpdateRoom();
  const deleteRoom = useDeleteRoom();

  const [showTeamForm, setShowTeamForm] = useState(false);
  const [showUserForm, setShowUserForm] = useState(false);
  const [showRoomForm, setShowRoomForm] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [newRoomName, setNewRoomName] = useState("");
  const [newPersonName, setNewPersonName] = useState("");
  const [newPersonEmail, setNewPersonEmail] = useState("");
  const [newPersonTeam, setNewPersonTeam] = useState("");
  const [newPersonRole, setNewPersonRole] = useState("MEMBER");
  const [newPersonExecutive, setNewPersonExecutive] = useState(false);
  const [createdPassword, setCreatedPassword] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<{ type: "team" | "room"; id: string; name: string } | null>(null);
  const [editingTeam, setEditingTeam] = useState<string | null>(null);
  const [editingTeamName, setEditingTeamName] = useState("");
  const [editingRoom, setEditingRoom] = useState<string | null>(null);
  const [editingRoomName, setEditingRoomName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const teamOptions = teams?.filter((t) => t.isActive) ?? [];

  async function handleCreateTeam(e: React.FormEvent) {
    e.preventDefault();
    if (!newTeamName.trim()) return;
    try {
      await createTeam.mutateAsync({ name: newTeamName.trim() });
      setNewTeamName("");
      setShowTeamForm(false);
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleCreateRoom(e: React.FormEvent) {
    e.preventDefault();
    if (!newRoomName.trim()) return;
    try {
      await createRoom.mutateAsync({ name: newRoomName.trim() });
      setNewRoomName("");
      setShowRoomForm(false);
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleCreatePerson(e: React.FormEvent) {
    e.preventDefault();
    if (!newPersonName.trim() || !newPersonEmail.trim()) return;
    try {
      const result = await createUser.mutateAsync({
        name: newPersonName.trim(),
        email: newPersonEmail.trim(),
        functionalTeamId: newPersonTeam || undefined,
        operationalRole: newPersonRole,
        isExecutive: newPersonExecutive,
      });
      setCreatedPassword(result.tempPassword);
      setNewPersonName(""); setNewPersonEmail(""); setNewPersonTeam(""); setNewPersonRole("MEMBER"); setNewPersonExecutive(false);
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleUpdateTeamName(id: string) {
    if (!editingTeamName.trim()) return;
    try {
      await updateTeam.mutateAsync({ id, data: { name: editingTeamName.trim() } });
      setEditingTeam(null);
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleUpdateRoomName(id: string) {
    if (!editingRoomName.trim()) return;
    try {
      await updateRoom.mutateAsync({ id, data: { name: editingRoomName.trim() } });
      setEditingRoom(null);
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-6 overflow-x-hidden">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-headline text-3xl font-bold text-on-surface">Organization Administration</h1>
          <p className="text-secondary text-sm mt-1">Manage teams, members, and rooms</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Teams", value: (teams?.length ?? 0).toString(), Icon: GroupsIcon, color: "text-primary" },
          { label: "Total Members", value: (users?.length ?? 0).toString(), Icon: PersonIcon, color: "text-tertiary" },
          { label: "Active Rooms", value: (rooms?.length ?? 0).toString(), Icon: MeetingRoomIcon, color: "text-primary" },
          { label: "Active Users", value: (users?.filter((u) => u.isActive).length ?? 0).toString(), Icon: PersonIcon, color: "text-secondary/80" },
        ].map((stat, i) => (
          <div key={i} className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 p-5 flex items-center gap-4">
            <div className={cn("w-10 h-10 rounded-xl bg-surface-container-high flex items-center justify-center", stat.color)}>
              <stat.Icon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold font-headline text-on-surface">{stat.value}</p>
              <p className="text-xs text-secondary font-body">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center border-b border-outline-variant/20 gap-1">
        {tabs.map((tab, i) => (
          <button key={tab} onClick={() => setActiveTab(i)}
            className={cn("px-5 py-3 text-sm font-semibold font-body border-b-2 transition-all",
              i === activeTab ? "border-primary text-primary" : "border-transparent text-secondary hover:text-on-surface hover:border-outline-variant/40"
            )}>
            {tab}
          </button>
        ))}
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-error/10 border border-error/20 text-sm text-error font-medium">
          {error}
          <button onClick={() => setError(null)} className="ml-3 underline">Dismiss</button>
        </div>
      )}

      {/* ── Teams Tab ── */}
      {activeTab === 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-secondary">{teams?.length ?? 0} team(s)</p>
            {isSecretary && (
              <button onClick={() => setShowTeamForm(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-5 py-2.5 text-sm font-semibold hover:brightness-110 active:scale-[0.98] transition-all">
                <PlusIcon className="h-4 w-4" /> Add Team
              </button>
            )}
          </div>
          <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 overflow-hidden">
            {teamsLoading ? <div className="p-12 text-center text-secondary">Loading teams...</div> : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-outline-variant/20">
                    <th className="text-left px-5 py-3 text-[11px] font-bold text-secondary uppercase tracking-wider">Team</th>
                    <th className="text-left px-5 py-3 text-[11px] font-bold text-secondary uppercase tracking-wider">Members</th>
                    <th className="text-left px-5 py-3 text-[11px] font-bold text-secondary uppercase tracking-wider">Status</th>
                    {isSecretary && <th className="text-right px-5 py-3 text-[11px] font-bold text-secondary uppercase tracking-wider">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {teams && teams.length > 0 ? teams.map((team) => (
                    <tr key={team.id} className="border-b border-outline-variant/10 hover:bg-surface-container-low/50 transition-colors">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center"><GroupsIcon className="h-4 w-4" /></div>
                          <div>
                            {editingTeam === team.id ? (
                              <div className="flex items-center gap-2">
                                <input value={editingTeamName} onChange={(e) => setEditingTeamName(e.target.value)}
                                  className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-2 py-1 text-sm text-on-surface outline-none focus:border-primary/50 w-40" autoFocus />
                                <button onClick={() => handleUpdateTeamName(team.id)} className="px-2 py-1 text-xs font-semibold text-primary hover:bg-primary/10 rounded-lg transition-colors">Save</button>
                                <button onClick={() => setEditingTeam(null)} className="px-2 py-1 text-xs font-semibold text-secondary hover:bg-surface-container-high rounded-lg transition-colors">Cancel</button>
                              </div>
                            ) : (
                              <p className="text-sm font-semibold text-on-surface">{team.name}</p>
                            )}
                            <p className="text-xs text-secondary">{team.id.slice(0, 8)}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <span className="inline-flex items-center justify-center min-w-[2rem] h-6 px-2 rounded-full bg-surface-container-high text-xs font-bold text-secondary">{team.members?.length ?? 0}</span>
                      </td>
                      <td className="px-5 py-4">
                        <span className={cn("text-xs font-semibold px-2.5 py-1 rounded-full", team.isActive ? "bg-primary/10 text-primary" : "bg-surface-container-high text-secondary")}>{team.isActive ? "Active" : "Inactive"}</span>
                      </td>
                      {isSecretary && (
                        <td className="px-5 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => { setEditingTeam(team.id); setEditingTeamName(team.name); }}
                              className="px-2.5 py-1.5 text-xs font-semibold text-secondary hover:text-on-surface bg-surface-container-high hover:bg-surface-container-higher rounded-lg transition-colors">Edit</button>
                            {team.isActive && (
                              <button onClick={() => setShowDeleteConfirm({ type: "team", id: team.id, name: team.name })}
                                className="px-2.5 py-1.5 text-xs font-semibold text-error hover:bg-error/10 rounded-lg transition-colors">Delete</button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  )) : (
                    <tr><td colSpan={4} className="p-12 text-center text-secondary">No teams created yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            )}
          </div>
        </div>
      )}

      {/* ── People Tab ── */}
      {activeTab === 1 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-secondary">{users?.length ?? 0} member(s)</p>
            {isSecretary && (
              <button onClick={() => setShowUserForm(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-5 py-2.5 text-sm font-semibold hover:brightness-110 active:scale-[0.98] transition-all">
                <PlusIcon className="h-4 w-4" /> Add Person
              </button>
            )}
          </div>
          <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 overflow-hidden">
            {usersLoading ? <div className="p-12 text-center text-secondary">Loading users...</div> : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-outline-variant/20">
                    <th className="text-left px-5 py-3 text-[11px] font-bold text-secondary uppercase tracking-wider">Name</th>
                    <th className="text-left px-5 py-3 text-[11px] font-bold text-secondary uppercase tracking-wider">Email</th>
                    <th className="text-left px-5 py-3 text-[11px] font-bold text-secondary uppercase tracking-wider">Role</th>
                    <th className="text-left px-5 py-3 text-[11px] font-bold text-secondary uppercase tracking-wider">Team</th>
                    <th className="text-left px-5 py-3 text-[11px] font-bold text-secondary uppercase tracking-wider">Status</th>
                    {isSecretary && <th className="text-right px-5 py-3 text-[11px] font-bold text-secondary uppercase tracking-wider">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {users && users.length > 0 ? users.map((u) => (
                    <tr key={u.id} className="border-b border-outline-variant/10 hover:bg-surface-container-low/50 transition-colors">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">{getInitials(u.name)}</div>
                          <p className="text-sm font-semibold text-on-surface">{u.name}</p>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-sm text-secondary">{u.email}</td>
                      <td className="px-5 py-4">
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-surface-container-high text-secondary">{u.operationalRole}</span>
                      </td>
                      <td className="px-5 py-4 text-sm text-secondary">{u.functionalTeam?.name ?? "—"}</td>
                      <td className="px-5 py-4">
                        <span className={cn("text-xs font-semibold px-2.5 py-1 rounded-full", u.isActive ? "bg-primary/10 text-primary" : "bg-surface-container-high text-secondary")}>{u.isActive ? "Active" : "Inactive"}</span>
                      </td>
                      {isSecretary && (
                        <td className="px-5 py-4 text-right">
                          <button onClick={() => {
                            const newRole = prompt(`Change role for ${u.name} (MEMBER / TEAM_ADMIN / SECRETARY):`, u.operationalRole);
                            if (newRole && ["MEMBER", "TEAM_ADMIN", "SECRETARY"].includes(newRole)) {
                              updateUser.mutateAsync({ id: u.id, data: { operationalRole: newRole } }).catch((err) => setError(err.message));
                            }
                          }} className="px-2.5 py-1.5 text-xs font-semibold text-secondary hover:text-on-surface bg-surface-container-high hover:bg-surface-container-higher rounded-lg transition-colors">Change Role</button>
                        </td>
                      )}
                    </tr>
                  )) : (
                    <tr><td colSpan={6} className="p-12 text-center text-secondary">No users found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            )}
          </div>
        </div>
      )}

      {/* ── Rooms Tab ── */}
      {activeTab === 2 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-secondary">{rooms?.length ?? 0} room(s)</p>
            {isSecretary && (
              <button onClick={() => setShowRoomForm(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-5 py-2.5 text-sm font-semibold hover:brightness-110 active:scale-[0.98] transition-all">
                <PlusIcon className="h-4 w-4" /> Add Room
              </button>
            )}
          </div>
          <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 overflow-hidden">
            {roomsLoading ? <div className="p-12 text-center text-secondary">Loading rooms...</div> : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-outline-variant/20">
                    <th className="text-left px-5 py-3 text-[11px] font-bold text-secondary uppercase tracking-wider">Room</th>
                    <th className="text-left px-5 py-3 text-[11px] font-bold text-secondary uppercase tracking-wider">Status</th>
                    {isSecretary && <th className="text-right px-5 py-3 text-[11px] font-bold text-secondary uppercase tracking-wider">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {rooms && rooms.length > 0 ? rooms.map((room) => (
                    <tr key={room.id} className="border-b border-outline-variant/10 hover:bg-surface-container-low/50 transition-colors">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-tertiary/10 text-tertiary flex items-center justify-center"><MeetingRoomIcon className="h-4 w-4" /></div>
                          <div>
                            {editingRoom === room.id ? (
                              <div className="flex items-center gap-2">
                                <input value={editingRoomName} onChange={(e) => setEditingRoomName(e.target.value)}
                                  className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-2 py-1 text-sm text-on-surface outline-none focus:border-primary/50 w-40" autoFocus />
                                <button onClick={() => handleUpdateRoomName(room.id)} className="px-2 py-1 text-xs font-semibold text-primary hover:bg-primary/10 rounded-lg transition-colors">Save</button>
                                <button onClick={() => setEditingRoom(null)} className="px-2 py-1 text-xs font-semibold text-secondary hover:bg-surface-container-high rounded-lg transition-colors">Cancel</button>
                              </div>
                            ) : (
                              <p className="text-sm font-semibold text-on-surface">{room.name}</p>
                            )}
                            <p className="text-xs text-secondary">{room.id.slice(0, 8)}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <span className={cn("text-xs font-semibold px-2.5 py-1 rounded-full", room.isActive ? "bg-primary/10 text-primary" : "bg-surface-container-high text-secondary")}>{room.isActive ? "Active" : "Inactive"}</span>
                      </td>
                      {isSecretary && (
                        <td className="px-5 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => { setEditingRoom(room.id); setEditingRoomName(room.name); }}
                              className="px-2.5 py-1.5 text-xs font-semibold text-secondary hover:text-on-surface bg-surface-container-high hover:bg-surface-container-higher rounded-lg transition-colors">Edit</button>
                            {room.isActive && (
                              <button onClick={() => setShowDeleteConfirm({ type: "room", id: room.id, name: room.name })}
                                className="px-2.5 py-1.5 text-xs font-semibold text-error hover:bg-error/10 rounded-lg transition-colors">Deactivate</button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  )) : (
                    <tr><td colSpan={3} className="p-12 text-center text-secondary">No rooms configured</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            )}
          </div>
        </div>
      )}

      {/* ── Modals ── */}

      <Modal open={showTeamForm} onClose={() => setShowTeamForm(false)} title="Add Team">
        <form onSubmit={handleCreateTeam} className="space-y-4 mt-2">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-on-surface/80">Team Name</span>
            <input value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)}
              className="w-full rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-4 py-2.5 text-sm text-on-surface outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/15" required />
          </label>
          <button type="submit" disabled={createTeam.isPending}
            className="w-full rounded-xl bg-primary text-primary-foreground py-2.5 text-sm font-semibold hover:brightness-110 disabled:opacity-60 transition-all">
            {createTeam.isPending ? "Creating..." : "Create Team"}
          </button>
        </form>
      </Modal>

      <Modal open={showUserForm} onClose={() => { setShowUserForm(false); setCreatedPassword(null); }} title="Add Person">
        {createdPassword ? (
          <div className="space-y-4 mt-2">
            <p className="text-sm text-secondary">Person created successfully.</p>
            <div className="rounded-xl bg-primary/5 border border-primary/20 p-4 space-y-2">
              <p className="text-sm font-semibold text-on-surface">Temporary Password</p>
              <p className="text-lg font-mono font-bold text-primary select-all">{createdPassword}</p>
              <p className="text-xs text-secondary">Share this with the user. They will need it to sign in.</p>
            </div>
            <button onClick={() => { setShowUserForm(false); setCreatedPassword(null); }}
              className="w-full rounded-xl bg-primary text-primary-foreground py-2.5 text-sm font-semibold hover:brightness-110 transition-all">
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleCreatePerson} className="space-y-4 mt-2">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-on-surface/80">Name</span>
              <input value={newPersonName} onChange={(e) => setNewPersonName(e.target.value)}
                className="w-full rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-4 py-2.5 text-sm text-on-surface outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15" required />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-on-surface/80">Email</span>
              <input type="email" value={newPersonEmail} onChange={(e) => setNewPersonEmail(e.target.value)}
                className="w-full rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-4 py-2.5 text-sm text-on-surface outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15" required />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-on-surface/80">Team</span>
              <select value={newPersonTeam} onChange={(e) => setNewPersonTeam(e.target.value)}
                className="w-full rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-4 py-2.5 text-sm text-on-surface outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15">
                <option value="">No team</option>
                {teamOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-on-surface/80">Role</span>
              <select value={newPersonRole} onChange={(e) => setNewPersonRole(e.target.value)}
                className="w-full rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-4 py-2.5 text-sm text-on-surface outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15">
                <option value="MEMBER">Member</option>
                <option value="TEAM_ADMIN">Team Admin</option>
                <option value="SECRETARY">Secretary</option>
              </select>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={newPersonExecutive} onChange={(e) => setNewPersonExecutive(e.target.checked)}
                className="w-4 h-4 rounded border-outline-variant/30 text-primary focus:ring-primary/15" />
              <span className="text-sm text-on-surface/80">Executive</span>
            </label>
            <button type="submit" disabled={createUser.isPending}
              className="w-full rounded-xl bg-primary text-primary-foreground py-2.5 text-sm font-semibold hover:brightness-110 disabled:opacity-60 transition-all">
              {createUser.isPending ? "Creating..." : "Create Person"}
            </button>
          </form>
        )}
      </Modal>

      <Modal open={showRoomForm} onClose={() => setShowRoomForm(false)} title="Add Room">
        <form onSubmit={handleCreateRoom} className="space-y-4 mt-2">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-on-surface/80">Room Name</span>
            <input value={newRoomName} onChange={(e) => setNewRoomName(e.target.value)}
              className="w-full rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-4 py-2.5 text-sm text-on-surface outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/15" required />
          </label>
          <button type="submit" disabled={createRoom.isPending}
            className="w-full rounded-xl bg-primary text-primary-foreground py-2.5 text-sm font-semibold hover:brightness-110 disabled:opacity-60 transition-all">
            {createRoom.isPending ? "Creating..." : "Create Room"}
          </button>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(null)}
        title={showDeleteConfirm?.type === "team" ? "Delete Team" : "Deactivate Room"}
        message={showDeleteConfirm?.type === "team"
          ? `Are you sure you want to delete "${showDeleteConfirm?.name}"? This cannot be undone.`
          : `Are you sure you want to deactivate "${showDeleteConfirm?.name}"?`}
        onConfirm={() => {
          if (showDeleteConfirm?.type === "team") {
            deleteTeam.mutateAsync(showDeleteConfirm.id).catch((err) => setError(err.message));
          } else if (showDeleteConfirm?.type === "room") {
            deleteRoom.mutateAsync(showDeleteConfirm.id).catch((err) => setError(err.message));
          }
          setShowDeleteConfirm(null);
        }}
      />
    </div>
  );
}

import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { api, unwrap } from "@/lib/api/client";
import { meetingKeys, dashboardKeys, calendarKeys, roomKeys, parkingLotKeys } from "@/lib/api/query-keys";
import type {
  MeetingDetail,
  MeetingLiveState,
  MeetingAttendee,
  MeetingBrowseResponse,
} from "@/types/api";
import type { QuickMeetingDto, StructuredMeetingDto, UpdateMeetingPayload } from "@/lib/api/contracts";

function fetchBrowseMeetings(filters?: Record<string, string | undefined>): Promise<MeetingBrowseResponse> {
  const params: Record<string, string> = {};
  if (filters?.cursor) params.cursor = filters.cursor;
  if (filters?.limit) params.limit = filters.limit;
  if (filters?.search) params.search = filters.search;
  if (filters?.statuses) params.statuses = filters.statuses;
  if (filters?.kinds) params.kinds = filters.kinds;
  if (filters?.ownerTeamId) params.ownerTeamId = filters.ownerTeamId;
  if (filters?.from) params.from = filters.from;
  if (filters?.to) params.to = filters.to;
  if (filters?.sort) params.sort = filters.sort;
  return unwrap<MeetingBrowseResponse>(api.get("meetings", { searchParams: Object.keys(params).length > 0 ? params : undefined }));
}

export function useBrowseMeetings(filters?: Record<string, string | undefined>) {
  return useQuery({
    queryKey: meetingKeys.browse(filters),
    queryFn: () => fetchBrowseMeetings(filters),
  });
}

function fetchMeeting(id: string): Promise<MeetingDetail> {
  return unwrap<MeetingDetail>(api.get(`meetings/${id}`));
}

export function useMeeting(id: string, options?: Partial<UseQueryOptions<MeetingDetail>>) {
  return useQuery({
    queryKey: meetingKeys.detail(id),
    queryFn: () => fetchMeeting(id),
    enabled: !!id,
    ...options,
  });
}

function fetchLiveState(id: string): Promise<MeetingLiveState> {
  return unwrap<MeetingLiveState>(api.get(`meetings/${id}/live-state`));
}

export function useLiveState(id: string) {
  return useQuery({
    queryKey: meetingKeys.liveState(id),
    queryFn: () => fetchLiveState(id),
    enabled: !!id,
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
  });
}

export function invalidateMeetingCreationQueries(qc: Pick<QueryClient, "invalidateQueries">, structured: boolean) {
  qc.invalidateQueries({ queryKey: meetingKeys.lists() });
  qc.invalidateQueries({ queryKey: meetingKeys.browse() });
  qc.invalidateQueries({ queryKey: dashboardKeys.all });
  qc.invalidateQueries({ queryKey: calendarKeys.all });
  qc.invalidateQueries({ queryKey: roomKeys.all });
  if (structured) qc.invalidateQueries({ queryKey: parkingLotKeys.all });
}

export function useCreateQuickMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: QuickMeetingDto) => unwrap<MeetingDetail>(api.post("meetings/quick", { json: data })),
    onSuccess: () => { invalidateMeetingCreationQueries(qc, false); },
  });
}

export function useCreateStructuredMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: StructuredMeetingDto) =>
      unwrap<MeetingDetail>(api.post("meetings/structured", { json: data })),
    onSuccess: () => {
      invalidateMeetingCreationQueries(qc, true);
    },
  });
}

export function useUpdateMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateMeetingPayload }) =>
      unwrap<MeetingDetail>(api.patch(`meetings/${id}`, { json: data })),
    onSuccess: (meeting) => {
      qc.invalidateQueries({ queryKey: meetingKeys.detail(meeting.id) });
      qc.invalidateQueries({ queryKey: meetingKeys.lists() });
      qc.invalidateQueries({ queryKey: meetingKeys.browse() });
      qc.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
}

export function useStartMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap<MeetingDetail>(api.post(`meetings/${id}/start`)),
    onSuccess: (meeting) => {
      qc.invalidateQueries({ queryKey: meetingKeys.detail(meeting.id) });
      qc.invalidateQueries({ queryKey: meetingKeys.lists() });
      qc.invalidateQueries({ queryKey: meetingKeys.browse() });
      qc.invalidateQueries({ queryKey: meetingKeys.liveState(meeting.id) });
      qc.invalidateQueries({ queryKey: dashboardKeys.all });
      qc.invalidateQueries({ queryKey: calendarKeys.all });
    },
  });
}

export function useEndMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap<MeetingDetail>(api.post(`meetings/${id}/end`)),
    onSuccess: (meeting) => {
      qc.invalidateQueries({ queryKey: meetingKeys.detail(meeting.id) });
      qc.invalidateQueries({ queryKey: meetingKeys.lists() });
      qc.invalidateQueries({ queryKey: meetingKeys.browse() });
      qc.invalidateQueries({ queryKey: meetingKeys.liveState(meeting.id) });
      qc.invalidateQueries({ queryKey: dashboardKeys.all });
      qc.invalidateQueries({ queryKey: calendarKeys.all });
    },
  });
}

export function useScheduleMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, scheduledAt }: { id: string; scheduledAt: string }) =>
      unwrap<MeetingDetail>(api.post(`meetings/${id}/schedule`, { json: { scheduledAt } })),
    onSuccess: (meeting) => {
      qc.invalidateQueries({ queryKey: meetingKeys.detail(meeting.id) });
      qc.invalidateQueries({ queryKey: meetingKeys.lists() });
      qc.invalidateQueries({ queryKey: meetingKeys.browse() });
      qc.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
}

export function useCancelMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, executiveRequestDisposition }: { id: string; executiveRequestDisposition?: "RETURN_TO_PLANNING" | "CANCEL_REQUEST" }) =>
      unwrap<MeetingDetail>(api.post(`meetings/${id}/cancel`, { json: { executiveRequestDisposition } })),
    onSuccess: (meeting) => {
      qc.invalidateQueries({ queryKey: meetingKeys.detail(meeting.id) });
      qc.invalidateQueries({ queryKey: meetingKeys.lists() });
      qc.invalidateQueries({ queryKey: meetingKeys.browse() });
      qc.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
}

export function useSubmitSummary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, summary }: { id: string; summary: string }) =>
      unwrap<MeetingDetail>(api.post(`meetings/${id}/summary`, { json: { summary } })),
    onSuccess: (meeting) => {
      qc.invalidateQueries({ queryKey: meetingKeys.detail(meeting.id) });
      qc.invalidateQueries({ queryKey: meetingKeys.lists() });
      qc.invalidateQueries({ queryKey: meetingKeys.browse() });
      qc.invalidateQueries({ queryKey: meetingKeys.liveState(meeting.id) });
      qc.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
}

export function useLockMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap<MeetingDetail>(api.post(`meetings/${id}/lock`)),
    onSuccess: (meeting) => {
      qc.invalidateQueries({ queryKey: meetingKeys.detail(meeting.id) });
      qc.invalidateQueries({ queryKey: meetingKeys.lists() });
      qc.invalidateQueries({ queryKey: meetingKeys.browse() });
      qc.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
}

export function useDeleteMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap<{ deleted: boolean }>(api.delete(`meetings/${id}`)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: meetingKeys.lists() });
      qc.invalidateQueries({ queryKey: meetingKeys.browse() });
      qc.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
}

export function useAddAttendee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ meetingId, userId }: { meetingId: string; userId: string }) =>
      unwrap<MeetingAttendee>(api.post(`meetings/${meetingId}/attendees`, { json: { userId } })),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: meetingKeys.detail(vars.meetingId) });
      qc.invalidateQueries({ queryKey: meetingKeys.browse() });
      qc.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
}

export function useRemoveAttendee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ meetingId, userId }: { meetingId: string; userId: string }) =>
      unwrap<{ removed: boolean }>(api.delete(`meetings/${meetingId}/attendees/${userId}`)),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: meetingKeys.detail(vars.meetingId) });
      qc.invalidateQueries({ queryKey: meetingKeys.browse() });
      qc.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
}

export function useSkipCurrentAgenda() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (meetingId: string) => unwrap<{ skipped: true }>(api.post(`meetings/${meetingId}/agenda/skip-current`)),
    onSuccess: (_data, meetingId) => {
      qc.invalidateQueries({ queryKey: meetingKeys.liveState(meetingId) });
      qc.invalidateQueries({ queryKey: meetingKeys.detail(meetingId) });
    },
  });
}

export function useExtendCurrentAgenda() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ meetingId, seconds }: { meetingId: string; seconds: number }) =>
      unwrap<{ extended: true }>(api.post(`meetings/${meetingId}/agenda/extend-current`, { json: { seconds } })),
    onSuccess: (_data, vars) => { qc.invalidateQueries({ queryKey: meetingKeys.liveState(vars.meetingId) }); },
  });
}

export function useExtendOvertime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ meetingId, seconds }: { meetingId: string; seconds: number }) =>
      unwrap<{ extended: true }>(api.post(`meetings/${meetingId}/overtime/extend`, { json: { seconds } })),
    onSuccess: (_data, vars) => { qc.invalidateQueries({ queryKey: meetingKeys.liveState(vars.meetingId) }); },
  });
}

export function useTakeoverMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (meetingId: string) =>
      unwrap<MeetingDetail>(api.post(`meetings/${meetingId}/takeover`)),
    onSuccess: (meeting) => {
      qc.invalidateQueries({ queryKey: meetingKeys.detail(meeting.id) });
      qc.invalidateQueries({ queryKey: meetingKeys.browse() });
      qc.invalidateQueries({ queryKey: meetingKeys.liveState(meeting.id) });
      qc.invalidateQueries({ queryKey: dashboardKeys.all });
      qc.invalidateQueries({ queryKey: calendarKeys.all });
    },
  });
}

export function useOverrideSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: { scheduledAt?: string; plannedDurationSeconds?: number; locationType?: "PHYSICAL" | "ONLINE" | "HYBRID"; roomId?: string | null; onlineLink?: string | null; allowRoomConflictOverride?: boolean; reason: string } }) =>
      unwrap<MeetingDetail>(api.post(`meetings/${id}/overrides/schedule`, { json: data })),
    onSuccess: (meeting) => {
      qc.invalidateQueries({ queryKey: meetingKeys.detail(meeting.id) });
      qc.invalidateQueries({ queryKey: meetingKeys.lists() });
      qc.invalidateQueries({ queryKey: meetingKeys.browse() });
      qc.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
}

export function useOverrideOrganizer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, organizerId, reason }: { id: string; organizerId: string; reason: string }) =>
      unwrap<MeetingDetail>(api.post(`meetings/${id}/overrides/organizer`, { json: { organizerId, reason } })),
    onSuccess: (meeting) => {
      qc.invalidateQueries({ queryKey: meetingKeys.detail(meeting.id) });
      qc.invalidateQueries({ queryKey: meetingKeys.browse() });
      qc.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
}

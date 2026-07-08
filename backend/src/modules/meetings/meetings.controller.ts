import { Request, Response } from "express";
import { asyncHandler } from "../../common/utils/async-handler";
import { resolveOrganizationId } from "../../common/utils/resolve-organization";
import { requireCanViewMeeting } from "../../policies/meeting-policy";
import { ValidationError } from "../../common/errors/app-error";
import * as meetingsService from "./meetings.service";
import { createMeetingSchema, updateMeetingSchema, createQuickMeetingSchema, createStructuredMeetingSchema } from "../../common/validators";
import { z } from "zod";

const takeoverBodySchema = z.object({}).strict();

const browseQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  search: z.string().optional(),
  statuses: z.string().optional(),
  kinds: z.string().optional(),
  ownerTeamId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  sort: z.enum(["UPCOMING", "RECENT", "TITLE"]).optional(),
});

export const getMeetings = asyncHandler(async (req: Request, res: Response) => {
  const parsed = browseQuerySchema.parse(req.query);
  const result = await meetingsService.browseMeetings(req.user!.sub, parsed);
  res.json(result);
});

export const getMeeting = asyncHandler(async (req: Request, res: Response) => {
  await requireCanViewMeeting(req.params.id as string, req.user!.sub);
  // Reconcile auto-lock on read
  await meetingsService.reconcilePendingFinalization(req.params.id as string);
  const meeting = await meetingsService.getMeetingDetail(req.params.id as string, req.user!.sub);
  res.json(meeting);
});

export const createMeeting = asyncHandler(async (req: Request, res: Response) => {
  const parsed = createMeetingSchema.parse(req.body);
  const organizationId = await resolveOrganizationId(req);
  const meeting = await meetingsService.createMeeting(req.user!.sub, {
    ...parsed,
    organizationId,
  });
  res.status(201).json(meeting);
});

export const createQuickMeeting = asyncHandler(async (req: Request, res: Response) => {
  const parsed = createQuickMeetingSchema.parse(req.body);
  const organizationId = await resolveOrganizationId(req);
  const meeting = await meetingsService.createQuickMeeting(req.user!.sub, {
    ...parsed,
    organizationId,
  });
  res.status(201).json(meeting);
});

export const createStructuredMeeting = asyncHandler(async (req: Request, res: Response) => {
  const parsed = createStructuredMeetingSchema.parse(req.body);
  const organizationId = await resolveOrganizationId(req);
  const meeting = await meetingsService.createStructuredMeeting(req.user!.sub, {
    ...parsed,
    organizationId,
  });
  res.status(201).json(meeting);
});

export const updateMeeting = asyncHandler(async (req: Request, res: Response) => {
  const lifecycleFrozen = ["status", "kind", "executiveRequestId"] as const;
  for (const field of lifecycleFrozen) {
    if (field in req.body) {
      throw new ValidationError(`${field} is frozen and cannot be mutated via PATCH. Use dedicated lifecycle endpoints.`, "STATUS_MUTATION_NOT_ALLOWED");
    }
  }
  const wholesaleDisabled = ["hosts", "attendees", "attendeeIds", "agendaItems", "speakerIds", "organizerId", "ownerTeamId"] as const;
  for (const field of wholesaleDisabled) {
    if (field in req.body) {
      throw new ValidationError(`Wholesale ${field} mutation via PATCH is disabled. Use focused endpoints.`, "WHOLESALE_MEETING_UPDATE_DISABLED");
    }
  }
  const parsed = updateMeetingSchema.parse(req.body);
  const meeting = await meetingsService.updateMeeting(req.params.id as string, req.user!.sub, parsed);
  res.json(meeting);
});

export const scheduleMeeting = asyncHandler(async (req: Request, res: Response) => {
  const meeting = await meetingsService.scheduleMeeting(req.params.id as string, req.user!.sub, req.body.scheduledAt);
  res.json(meeting);
});

export const startMeeting = asyncHandler(async (req: Request, res: Response) => {
  const meeting = await meetingsService.startMeeting(req.params.id as string, req.user!.sub);
  res.json(meeting);
});

export const completeMeeting = asyncHandler(async (req: Request, res: Response) => {
  const meeting = await meetingsService.completeMeeting(req.params.id as string, req.user!.sub);
  res.json(meeting);
});

export const endMeeting = asyncHandler(async (req: Request, res: Response) => {
  const meeting = await meetingsService.endMeeting(req.params.id as string, req.user!.sub);
  res.json(meeting);
});

export const submitSummary = asyncHandler(async (req: Request, res: Response) => {
  const { summary } = req.body;
  const meeting = await meetingsService.submitSummary(req.params.id as string, req.user!.sub, summary);
  res.json(meeting);
});

export const lockMeeting = asyncHandler(async (req: Request, res: Response) => {
  const meeting = await meetingsService.lockMeeting(req.params.id as string, req.user!.sub);
  res.json(meeting);
});

export const archiveMeeting = asyncHandler(async (req: Request, res: Response) => {
  const meeting = await meetingsService.archiveMeeting(req.params.id as string, req.user!.sub);
  res.json(meeting);
});

export const cancelMeeting = asyncHandler(async (req: Request, res: Response) => {
  const meeting = await meetingsService.cancelMeeting(req.params.id as string, req.user!.sub, req.body.executiveRequestDisposition);
  res.json(meeting);
});

export const deleteMeeting = asyncHandler(async (req: Request, res: Response) => {
  await meetingsService.deleteMeeting(req.params.id as string, req.user!.sub);
  res.json({ deleted: true });
});

export const overrideSchedule = asyncHandler(async (req: Request, res: Response) => {
  const meeting = await meetingsService.overrideScheduleMeeting(req.params.id as string, req.user!.sub, req.body);
  res.json(meeting);
});

export const overrideOrganizer = asyncHandler(async (req: Request, res: Response) => {
  const meeting = await meetingsService.overrideOrganizer(req.params.id as string, req.user!.sub, req.body);
  res.json(meeting);
});

export const addAttendee = asyncHandler(async (req: Request, res: Response) => {
  const meeting = await meetingsService.addMeetingAttendee(req.params.id as string, req.user!.sub, req.body.userId);
  res.status(201).json(meeting);
});

export const removeAttendee = asyncHandler(async (req: Request, res: Response) => {
  await meetingsService.removeMeetingAttendee(req.params.id as string, req.user!.sub, req.params.userId as string);
  res.json({ removed: true });
});

// ── Phase 4a: Live timer & agenda commands ──

export const getLiveState = asyncHandler(async (req: Request, res: Response) => {
  const state = await meetingsService.getLiveState(req.params.id as string, req.user!.sub);
  res.json(state);
});

export const skipCurrent = asyncHandler(async (req: Request, res: Response) => {
  await meetingsService.skipCurrentAgendaItem(req.params.id as string, req.user!.sub);
  res.json({ skipped: true });
});

export const extendCurrent = asyncHandler(async (req: Request, res: Response) => {
  await meetingsService.extendCurrentAgendaItem(req.params.id as string, req.user!.sub, req.body.seconds);
  res.json({ extended: true });
});

export const extendOvertime = asyncHandler(async (req: Request, res: Response) => {
  await meetingsService.extendOvertime(req.params.id as string, req.user!.sub, req.body.seconds);
  res.json({ extended: true });
});

export const takeover = asyncHandler(async (req: Request, res: Response) => {
  takeoverBodySchema.parse(req.body ?? {});
  const meeting = await meetingsService.takeoverMeeting(req.params.id as string, req.user!.sub);
  res.json(meeting);
});

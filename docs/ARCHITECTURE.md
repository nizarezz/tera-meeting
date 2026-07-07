# Terra Meetings — Architecture & Full System Report

> Enterprise Meeting Suite — Real-time meeting management with executive workflows, parking lot, and live collaboration.

---

## Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Backend](#backend)
  - [Server Startup](#server-startup)
  - [Auth Flow](#auth-flow)
  - [Module Map](#module-map)
  - [Key Business Rules](#key-business-rules)
  - [Database Schema](#database-schema)
  - [Workers & Real-time](#workers--real-time)
- [Frontend](#frontend)
  - [Provider Hierarchy](#provider-hierarchy)
  - [Route Map](#route-map)
  - [Design System](#design-system)
  - [API Layer](#api-layer)
  - [Key Features](#key-features)
- [Deployment](#deployment)
- [Testing](#testing)
- [End-to-End Flows](#end-to-end-flows)

---

## Overview

Terra Meetings is a full-stack meeting management platform designed for organizations that need structured meeting workflows, executive request handling, and real-time live meeting collaboration.

**Core capabilities:**
- Quick and structured meeting creation with agenda management
- Real-time live meetings with timer, agenda progression, and notes
- Executive request workflows (create → plan → schedule)
- Parking lot for agenda items with approval pipeline
- Role-based access (Secretary, Team Admin, Member, Executive)
- Dark mode with Material Design 3 tokens

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Frontend** | Next.js (App Router) | 16.2 |
| | React | 19.2 |
| | Tailwind CSS | v4 |
| | TanStack React Query | v5 |
| | Zustand | — |
| | ky (HTTP client) | — |
| | Supabase Auth | `@supabase/ssr` |
| **Backend** | Node.js + Express | 5 |
| | Prisma ORM | 7.8 |
| | Zod (validation) | 4.4 |
| | Socket.IO | 4.8 |
| | vitest | 4.1 |
| **Database** | Neon (serverless PostgreSQL) | — |
| **Auth** | Supabase (JWT, JWKS/ES256 + HS256 fallback) | — |
| **Hosting** | Vercel (frontend) + Render (backend) | — |
| **Tests** | 374 backend + 139 frontend | **513 total** |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      User Browser                       │
└──────────────────────────┬──────────────────────────────┘
                           │ HTTPS
┌──────────────────────────▼──────────────────────────────┐
│                  Vercel (Next.js)                        │
│            Frontend — React 19 + Tailwind               │
│            Static + ISR, Edge Network                    │
└──────────────────────────┬──────────────────────────────┘
                           │ REST + Socket.IO
┌──────────────────────────▼──────────────────────────────┐
│                Render (Express Backend)                  │
│            API — Express 5 + Prisma 7                   │
│            Workers: auto-lock, live-reconciler           │
│            Real-time: Socket.IO rooms per meeting        │
└──────────────────────────┬──────────────────────────────┘
                           │ Prisma + Neon Adapter
┌──────────────────────────▼──────────────────────────────┐
│              Neon (PostgreSQL)                           │
│            Serverless, connection pooling                │
│            17 models, 12 enums                          │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│              Supabase Auth                               │
│            JWT tokens, JWKS verification                 │
│            User management, password reset               │
└─────────────────────────────────────────────────────────┘
```

---

## Backend

### Server Startup

`src/server.ts` boots in this order:

1. **Validate environment** — `env.ts` auto-validates required vars on import
2. **Verify database** — `SELECT 1` via Prisma, exits on failure
3. **Create HTTP server** — wraps Express app
4. **Create Socket.IO** — with CORS, exports `getIO()` singleton
5. **Register socket handlers** — `meeting:join` / `meeting:leave` for room-based events
6. **Listen** on `0.0.0.0:${PORT}` (default 4000)
7. **Start workers** — auto-lock (60s), live-reconciler (1s)
8. **Graceful shutdown** — SIGTERM/SIGINT → stop workers → close server → exit after 5s

### Auth Flow

```
Supabase issues JWT
       ↓
Backend extracts Bearer token
       ↓
Verify via JWKS (ES256 primary)
       ↓ (fallback)
Verify via HS256 JWT secret
       ↓
req.user = { sub, email, name, role }
       ↓
/auth/me auto-provisions user in DB if not found
```

- First user in an org gets `SECRETARY` role when `FIRST_USER_ROLE_SECRETARY=true`
- Users are linked by Supabase Auth UUID (`sub` claim)

### Module Map

#### Core Modules

| Module | Mount | Endpoints | Description |
|--------|-------|-----------|-------------|
| **auth** | `/auth` | 1 | User profile, auto-provisioning |
| **meetings** | `/meetings` | 22 | Full lifecycle: create, schedule, start, live controls, end, summary, cancel, delete, override, attendees, browse |
| **calendar** | `/calendar` | 4 | Day view (timezone-aware), weekly view, available slots, draft nudges |
| **dashboard** | `/dashboard` | 1 | Aggregated view: today count, next meeting, live meetings, summaries, capabilities |

#### Support Modules

| Module | Mount | Endpoints | Description |
|--------|-------|-----------|-------------|
| **rooms** | `/rooms` | 6 | CRUD, conflict checking, soft-delete with booking guards |
| **agenda** | `/agenda` | 7 | List/get (active), create/update/delete/reorder (disabled, 410) |
| **notes** | `/notes` | 2 | One-note-per-user during live meetings |
| **reports** | `/reports` | 2 | Full meeting report, log (disabled) |
| **timer** | `/timer` | 2 | All disabled (410), live state via meetings |
| **search** | `/search` | 1 | Meetings + notes full-text search |

#### Workflow Modules

| Module | Mount | Endpoints | Description |
|--------|-------|-----------|-------------|
| **executive-requests** | `/executive-requests` | 8 | Full workflow: create (executive), plan (secretary), schedule, cancel |
| **parking-lot** | `/parking-lot` | 7 | Create, approve, archive, add-to-agenda (validated) |
| **cross-team-invites** | `/cross-team-invites` | 3 | Create, review, auto-add attendee on approval |
| **meeting-join-requests** | `/meeting-join-requests` | 2 | Request join (live only), organizer review |

#### Admin Modules

| Module | Mount | Endpoints | Description |
|--------|-------|-----------|-------------|
| **teams** | `/teams` | 7 | CRUD, member add/remove, soft-delete with guards |
| **users** | `/users` | 5 | CRUD, approval, role-based authorization |
| **organizations** | `/organizations` | 1 | Audit event feed (secretary only) |
| **notifications** | `/notifications` | 6 | List, unread count (30s poll), mark read, preferences |

#### Placeholders

| Module | Mount | Endpoints | Description |
|--------|-------|-----------|-------------|
| **files** | `/files` | 0 | Not yet implemented |
| **speakers** | `/speakers` | 0 | Not yet implemented |

### Meeting Lifecycle

```
DRAFT ──→ SCHEDULED ──→ IN_PROGRESS ──→ ENDED_PENDING_SUMMARY ──→ COMPLETED_LOCKED
  │            │              │                    │
  │            │              │                    └──→ COMPLETED_LOCKED (auto-lock, 60s)
  │            │              └──→ ENDED_PENDING_SUMMARY (organizer ends)
  │            └──→ SCHEDULED (scheduleMeeting validates future date, room conflict)
  └──→ CANCELLED (cancelMeeting, releases bookings)
```

**Secretary overrides:**
- `overrideSchedule` — reschedule structured meetings within ER window
- `overrideOrganizer` — reassign organizer (must be attendee)
- `takeover` — secretary becomes organizer of live meeting

### Key Business Rules

| Rule | Enforcement |
|------|------------|
| **Location invariants** | PHYSICAL/HYBRID require room; ONLINE forbids room — enforced at Zod validation + DTO mapping |
| **Room booking safety** | `pg_advisory_xact_lock` per room ID prevents double-booking |
| **Role hierarchy** | SECRETARY (org-wide) > TEAM_ADMIN (team) > MEMBER |
| **Cursor injection prevention** | Base64url JSON with version=1, sort validation |
| **Frozen fields** | status, kind, executiveRequestId cannot be updated via PATCH |
| **One note per user** | Notes service enforces single note per user per meeting |
| **Parking lot → agenda** | Only APPROVED items, same org/team, STRUCTURED meeting, DRAFT/SCHEDULED status |
| **Executive request windows** | MORNING: 08:00-12:00, AFTERNOON: 13:00-17:00 |
| **Summary deadline** | Auto-locks meetings past deadline via background worker |

### Database Schema

#### Enums (12)

```
MeetingStatus:      DRAFT | SCHEDULED | IN_PROGRESS | ENDED_PENDING_SUMMARY | COMPLETED_LOCKED | CANCELLED
MeetingKind:        QUICK_TEAM | STRUCTURED
OperationalRole:    MEMBER | TEAM_ADMIN | SECRETARY
LocationType:       PHYSICAL | ONLINE | HYBRID
AgendaItemStatus:   NOT_STARTED | IN_PROGRESS | COMPLETED | SKIPPED
ParkingLotStatus:   PENDING_REVIEW | APPROVED | USED_IN_AGENDA | ARCHIVED
ExecutiveRequestStatus: OPEN | PLANNING | SCHEDULED | COMPLETED | CANCELLED
ExecutiveRequestTargetType: USER | TEAM
PreferredPeriod:    MORNING | AFTERNOON
CrossTeamInviteStatus: PENDING | APPROVED | DECLINED
MeetingJoinRequestStatus: PENDING | APPROVED | DECLINED
NotificationType:   MEETING_INVITATION | MEETING_REMINDER | MEETING_UPDATED | MEETING_CANCELLED | ATTENDEE_REMOVED
```

#### Models (17)

```
Organization ──┬── FunctionalTeam ──┬── User ──┬── Meeting ──┬── MeetingAttendee
               │                    │          │             ├── AgendaItem ── AgendaItemSpeaker
               │                    │          │             ├── MeetingTimer
               │                    │          │             ├── MeetingNote
               │                    │          │             ├── RoomBooking
               │                    │          │             ├── CrossTeamInvite
               │                    │          │             ├── MeetingJoinRequest
               │                    │          │             └── AuditEvent
               │                    │          │
               │                    │          ├── ExecutiveRequest ── ExecutiveRequestTarget
               │                    │          ├── ParkingLotItem
               │                    │          └── Notification / NotificationPreference
               │                    │
               │                    └── (Team members via functionalTeamId)
               │
               ├── Room ── RoomBooking
               ├── Template ── TemplateAgendaItem
               └── AuditEvent
```

#### Key Indexes

- `meetings`: `(organizationId, status, scheduledAt)`, `(ownerTeamId, scheduledAt)`
- `audit_events`: `(organizationId, createdAt)`, `(meetingId)`
- `parking_lot_items`: `(teamId, status)`

### Workers & Real-time

| Worker | Interval | What It Does |
|--------|----------|-------------|
| **auto-lock** | 60s | Finds `ENDED_PENDING_SUMMARY` meetings past `summaryAutoLockedAt`, transitions to `COMPLETED_LOCKED` |
| **live-reconciler** | 1s | Finds all `IN_PROGRESS` meetings, auto-advances expired agenda items, handles overtime, auto-ends meeting |

| Socket Event | Direction | Payload |
|-------------|-----------|---------|
| `meeting:join` | Client → Server | `{ meetingId }` — joins Socket.IO room |
| `meeting:leave` | Client → Server | `{ meetingId }` — leaves room |
| `meeting:update` | Server → Client | `{ meetingId, event, data }` — broadcasts to room |

---

## Frontend

### Provider Hierarchy

```
<html>
  └── RootLayout (server component)
      ├── Google Fonts: Manrope + Work Sans
      ├── Dark mode flash-prevention script
      └── (app)/layout.tsx (client component)
          └── ThemeProvider
              └── AuthProvider (Supabase session)
                  └── QueryProvider (React Query, 5min stale, 30min GC)
                      └── AuthGate (redirects to /login if unauthenticated)
                          └── AppLayout (sidebar navigation)
                              └── {children} (page content)
```

### Route Map

#### Public Routes

| Route | File | Description |
|-------|------|-------------|
| `/` | `app/page.tsx` | Redirects to `/dashboard` |
| `/login` | `app/login/page.tsx` | Email/password form, Supabase auth, forgot password |
| `/signup` | `app/signup/page.tsx` | "Signup unavailable" (admin-only accounts) |

#### Authenticated Routes

| Route | File | Description |
|-------|------|-------------|
| `/dashboard` | `app/(app)/dashboard/page.tsx` | Greeting, today's meetings, next meeting hero, live now, summaries, recent records |
| `/meetings` | `app/(app)/meetings/page.tsx` | Filterable list with cursor pagination, row actions |
| `/meetings/new` | `app/(app)/meetings/new/page.tsx` | Chooser: Quick vs Structured |
| `/meetings/new/quick` | `app/(app)/meetings/new/quick/page.tsx` | Single-page quick meeting form |
| `/meetings/new/structured` | `app/(app)/meetings/new/structured/page.tsx` | 4-step wizard: Basics → Agenda → People/Location → Review |
| `/meetings/[id]` | `app/(app)/meetings/[id]/page.tsx` | Full detail: overview, participants, agenda timeline, actions |
| `/meetings/[id]/live` | `app/(app)/meetings/[id]/live/page.tsx` | Real-time: timer, agenda, notes, summary, controls |
| `/calendar` | `app/(app)/calendar/page.tsx` | Day view with time axis, date navigation |
| `/parking-lot` | `app/(app)/parking-lot/page.tsx` | Status tabs, CRUD, approve/archive, add-to-agenda |
| `/executive-requests` | `app/(app)/executive-requests/page.tsx` | Role-aware inbox (all/mine/assigned), status filters |
| `/executive-requests/new` | `app/(app)/executive-requests/new/page.tsx` | Create ER (executives only) |
| `/executive-requests/[id]` | `app/(app)/executive-requests/[id]/page.tsx` | Detail with targets, linked meeting, actions |
| `/executive-requests/[id]/plan` | `app/(app)/executive-requests/[id]/plan/page.tsx` | Complex planning form with agenda + parking lot |
| `/notifications` | `app/(app)/notifications/page.tsx` | List with unread indicator, 30s poll |
| `/admin` | `app/(app)/admin/page.tsx` | Stats grid + tabbed Teams/People/Rooms |

### Design System

**Material Design 3 tokens** defined in `globals.css`:

```
Light Mode                          Dark Mode
─────────────────────               ─────────────────────
Primary:    #2e5838 (green)         Primary:    #5f9472
Secondary:  #7a7569 (warm gray)     Secondary:  #c4c3bf
Tertiary:   #8b5a00 (amber)         Tertiary:   #ffb2be
Error:      #ba1a1a (red)           Error:      #ffb4ab
Surface:    #fefdf8 (cream)         Surface:    #131313 (near-black)
```

**Typography:**
- Headlines: Manrope (400-800)
- Body: Work Sans (300-700)

**Dark mode:** `.dark` class on `<html>`, persisted to `localStorage`, system preference detection.

**Components:**
- 37 custom SVG icons (`components/icons.tsx`)
- shadcn-style Button with 6 variants, 8 sizes
- StatusBadge, KindBadge, formatDuration, formatTime, formatDate (from `meeting-presentation.tsx`)

### API Layer

```
Frontend Component
       ↓ useQuery / useMutation
React Query Hook (queries/*.ts)
       ↓ api.get() / api.post()
ky HTTP client (client.ts)
       ↓ beforeRequest: attach Bearer token
       ↓ afterResponse: throw ApiError on failure
Express Backend
       ↓ wrapResponse middleware
{ success: true, data: ... }
       ↓ unwrap<T>() extracts data
```

**Key files:**

| File | Purpose |
|------|---------|
| `lib/api/client.ts` | ky instance with auth injection, `unwrap<T>()`, `ApiError` |
| `lib/api/contracts.ts` | DTO shape definitions |
| `lib/api/mappers.ts` | Form state → DTO conversion (minutes → seconds) |
| `lib/api/query-keys.ts` | Factory functions for React Query cache keys |
| `lib/api/queries/*.ts` | 12 query/mutation hook files |

### Key Features

| Feature | Implementation |
|---------|---------------|
| **Real-time live meetings** | Socket.IO rooms + 10s polling + local countdown |
| **One-note-per-user** | Notes service enforces, visibility rules enforced |
| **Capability-gated UI** | Every action button checks `MeetingCapabilities` |
| **Cursor-based pagination** | Accumulated results, filter-change reset |
| **Role-aware views** | Secretary sees all, executives see own, members see assigned |
| **Dark mode** | Runtime token switching, no flash on load |
| **Bundle isolation** | Supabase client lazy-loaded, not in main bundle |

---

## Deployment

### Backend (Render)

```yaml
# render.yaml
Service: Web (free plan)
Runtime: Node
Build: npm ci && npm run build
Start: npm run start  # prisma migrate deploy && node dist/server.js
Health: /health
```

**Environment variables:**
```
DATABASE_URL=postgresql://...@ep-...-pooler.../neondb?sslmode=require
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_JWT_SECRET=your-secret
CORS_ORIGIN=https://tera-meeting.vercel.app
FRONTEND_URL=https://tera-meeting.vercel.app
PORT=4000
```

### Frontend (Vercel)

```yaml
Framework: Next.js
Root Directory: frontend
Build: npm run build
Output: .next
```

**Environment variables:**
```
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
NEXT_PUBLIC_API_URL=https://tera-meeting.onrender.com
NEXT_PUBLIC_SOCKET_URL=https://tera-meeting.onrender.com
```

### Demo Data

Seed via `POST /seed` endpoint or `npm run demo:seed`.

Creates:
- 1 organization (Terra Demo Co.)
- 2 teams (Sales, Operations)
- 7 users (Secretary, Sales Admin, Ops Admin, Sales Member, Ops Member, Executive, Speaker)
- 2 rooms (Boardroom, Huddle Room)
- 3 meetings (Quick Scheduled, Structured Scheduled, Completed)
- 2 parking lot items (Pending, Approved)
- 1 executive request (Open)
- 3 notifications

---

## Testing

### Backend (374 tests)

| File | Tests | Coverage |
|------|-------|----------|
| `contract-safety.test.ts` | Schema validation, location rules, persistence | Creation contracts |
| `meetings.test.ts` | 30+ | Full lifecycle, room conflicts, overrides, attendees |
| `policies.test.ts` | Policy tests | Access, meeting, team policies |
| `timer.test.ts` | Timer tests | Live timer, overtime, agenda progression |
| `phase-6c.test.ts` | 23 | Browse/calendar visibility, filters, pagination, cursor |
| `security-fixes.test.ts` | 19 | Auth checks, room conflicts, status guards |
| `parking-lot.test.ts` | 12 | CRUD, status transitions |
| `parking-lot-policy.test.ts` | 19 | Role-based access |
| `executive-requests.test.ts` | Full ER lifecycle | Create, plan, schedule, cancel |
| `notes-privacy.test.ts` | Privacy tests | Note visibility rules |
| `notifications-privacy.test.ts` | 6 | Notification ownership |
| `cross-team-invites.test.ts` | Invite tests | Create, review, attendee creation |
| `creation-enforcement.test.ts` | Enforcement tests | Role-based meeting creation |

### Frontend (139 tests)

| File | Tests | Coverage |
|------|-------|----------|
| `theme-provider.test.tsx` | 7 | Light/dark toggle, persistence, system preference |
| `meeting-creation-ui.test.tsx` | 11 | Team locking, validation, location, error handling |
| `meeting-detail.test.tsx` | 24 | Status badges, capabilities, actions, modals |
| `live-meeting-controls.test.tsx` | 26 | Controls, countdown, notes, summary |
| `executive-request-flow.test.tsx` | 18 | Role-aware endpoints, permissions, mapper |
| `parking-lot-notifications.test.tsx` | 11 | Tabs, controls, agenda linking |
| `auth-bundle-isolation.test.tsx` | 4 | No Supabase in main bundle |
| `integration.test.ts` | 9 | DTO mappers, validation, error handling |
| `phase-6c.test.tsx` | 13 | Browse, calendar, pagination, mutations |

### Running Tests

```bash
# Backend
cd backend && npm test

# Frontend
cd frontend && npm test

# With coverage
cd backend && npx vitest run --coverage
cd frontend && npx vitest run --coverage
```

---

## End-to-End Flows

### 1. Authentication

```
User enters email/password
       ↓
Frontend calls Supabase signInWithPassword()
       ↓
Supabase returns JWT + refresh token
       ↓
Frontend stores session in localStorage
       ↓
All API calls include Authorization: Bearer <jwt>
       ↓
Backend verifies JWT (JWKS → HS256 fallback)
       ↓
Backend auto-provisions user in DB if new
       ↓
Dashboard loads with role-appropriate data
```

### 2. Meeting Creation (Structured)

```
User selects "Structured Meeting"
       ↓
Step 1: Title, Team, Duration, Date, Time
       ↓
Step 2: Agenda items (title, duration, speakers)
       ↓
Step 3: Location (Physical/Online/Hybrid), Room, Attendees, Parking Lot items
       ↓
Step 4: Review → Submit
       ↓
Frontend mapper: form state (minutes) → DTO (seconds)
       ↓
POST /meetings/structured
       ↓
Backend validates: role, team, attendees, speakers, room conflict
       ↓
pg_advisory_xact_lock prevents concurrent booking
       ↓
Creates: Meeting + AgendaItems + RoomBooking + Attendees
       ↓
Invalidates: dashboard, calendar, meetings queries
       ↓
Redirects to meeting detail page
```

### 3. Live Meeting

```
Organizer clicks "Start Meeting"
       ↓
POST /meetings/:id/start
       ↓
Status: SCHEDULED → IN_PROGRESS
Creates MeetingTimer, activates first agenda item
       ↓
Socket.IO: join meeting room
       ↓
Live state polls every 10 seconds
Local countdown ticks every 1 second
       ↓
Controls:
  - Skip Current Item → next agenda item
  - Extend +5/+10/+15 min → adds time
  - Overtime Extend → 5 min overtime
  - End Meeting → IN_PROGRESS → ENDED_PENDING_SUMMARY
       ↓
Live reconciler (1s) auto-advances expired items
       ↓
Organizer submits summary
       ↓
Status → COMPLETED_LOCKED
```

### 4. Executive Request

```
Executive creates request (title, date, duration, targets)
       ↓
POST /executive-requests
Status: OPEN
       ↓
Secretary sees in "All" inbox
Target sees in "Assigned" inbox
       ↓
Secretary clicks "Start Planning"
POST /executive-requests/:id/start-planning
Status: OPEN → PLANNING
       ↓
Secretary plans meeting:
  - Selects team, date, time window
  - Adds attendees, agenda
  - Links approved parking lot items
POST /executive-requests/:id/plan-meeting
       ↓
Creates meeting + room booking
Links parking lot items
Status: PLANNING → SCHEDULED
       ↓
Meeting proceeds through normal lifecycle
       ↓
Status: SCHEDULED → COMPLETED
```

### 5. Parking Lot

```
Member creates item (title, note)
       ↓
POST /parking-lot
Status: PENDING_REVIEW
       ↓
Team Admin / Secretary reviews
  - Approve → APPROVED
  - Archive → ARCHIVED
       ↓
APPROVED item can be added to agenda
       ↓
"Add to Agenda" → select structured meeting (DRAFT/SCHEDULED)
       ↓
POST /parking-lot/:id/addToAgenda
Status: APPROVED → USED_IN_AGENDA
Item linked to meeting via agendaMeetingId
```

---

## Project Structure

```
meetings 2/
├── backend/
│   ├── src/
│   │   ├── common/           # Middleware, errors, validators, types
│   │   │   ├── middleware/   # auth, response, error-handler
│   │   │   ├── errors/       # AppError, NotFoundError, ValidationError
│   │   │   ├── validators/   # Zod schemas (create/update meeting, etc.)
│   │   │   ├── types/        # PaginationParams, PaginatedResponse
│   │   │   ├── constants/    # Meeting statuses, RSVP statuses
│   │   │   └── utils/        # asyncHandler, resolveOrganization
│   │   ├── config/           # env, database, logger, socket
│   │   ├── modules/          # 20 feature modules
│   │   │   ├── auth/
│   │   │   ├── meetings/     # 4 files: routes, controller, service, timer
│   │   │   ├── calendar/
│   │   │   ├── dashboard/
│   │   │   ├── rooms/
│   │   │   ├── agenda/
│   │   │   ├── notes/
│   │   │   ├── reports/
│   │   │   ├── timer/
│   │   │   ├── notifications/
│   │   │   ├── search/
│   │   │   ├── teams/
│   │   │   ├── executive-requests/
│   │   │   ├── parking-lot/
│   │   │   ├── cross-team-invites/
│   │   │   ├── meeting-join-requests/
│   │   │   ├── organizations/
│   │   │   ├── users/
│   │   │   ├── files/        # Placeholder (empty)
│   │   │   └── speakers/     # Placeholder (empty)
│   │   ├── policies/         # Access, meeting, team, visibility policies
│   │   ├── shared/           # Permission service
│   │   ├── services/         # Audit service (cross-cutting)
│   │   ├── sockets/          # Socket.IO handlers
│   │   ├── workers/          # Auto-lock, live-reconciler
│   │   ├── prisma/           # Schema, migrations, seed scripts
│   │   ├── app.ts            # Express app setup
│   │   └── server.ts         # Server entry point
│   ├── prisma/
│   │   ├── demo-seed.ts      # Demo data with production guards
│   │   ├── qa-reset.ts       # QA reset with production guards
│   │   └── seed.ts           # Basic seed
│   ├── docs/                 # Deployment runbook, defects, QA
│   └── __tests__/            # 17 test files (374 tests)
│
├── frontend/
│   ├── src/
│   │   ├── app/              # Next.js App Router pages
│   │   │   ├── layout.tsx    # Root layout (fonts, dark mode script)
│   │   │   ├── page.tsx      # Redirects to /dashboard
│   │   │   ├── globals.css   # Design tokens (70+ variables)
│   │   │   ├── app-layout.tsx # Sidebar navigation
│   │   │   ├── login/        # Login page
│   │   │   ├── signup/       # Signup (unavailable)
│   │   │   └── (app)/        # Authenticated routes
│   │   │       ├── layout.tsx # Provider stack
│   │   │       ├── dashboard/
│   │   │       ├── meetings/
│   │   │       ├── calendar/
│   │   │       ├── parking-lot/
│   │   │       ├── executive-requests/
│   │   │       ├── notifications/
│   │   │       └── admin/
│   │   ├── features/         # Feature-specific logic
│   │   │   ├── meetings/     # Creation form, presentation utils
│   │   │   └── executive-requests/ # Targets, permissions
│   │   ├── lib/              # Utilities
│   │   │   ├── api/          # Client, contracts, mappers, query-keys
│   │   │   │   └── queries/  # 12 query hook files
│   │   │   └── supabase/     # Browser client, lazy loader
│   │   ├── components/       # Icons, theme toggle, button UI, auth provider
│   │   ├── providers/        # QueryProvider, ThemeProvider
│   │   ├── types/            # api.ts (496 lines of TypeScript types)
│   │   └── __tests__/        # 10 test files (139 tests)
│   └── docs/                 # Bundle hotspots, performance baseline
│
└── docs/
    └── ARCHITECTURE.md       # This file
```

---

## Deployment URLs

| Service | URL | Status |
|---------|-----|--------|
| Backend | `https://tera-meeting.onrender.com` | Live |
| Frontend | `https://tera-meeting.vercel.app` | Live |
| Database | `ep-round-morning-abb6i4gp` (Neon) | Live |
| Auth | Supabase project | Live |

**Health check:** `GET /health` → `{"ok":true,"service":"terra-meetings-api"}`

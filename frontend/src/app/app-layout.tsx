"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useCurrentUser } from "@/lib/api/queries/auth";
import { useUnreadCount, useNotifications } from "@/lib/api/queries/notifications";
import { useAuth } from "@/components/providers/auth-provider";
import { DashboardIcon, GroupsIcon, ParkingIcon, PriorityHighIcon, CalendarIcon, NotificationsIcon, AdminIcon, PlusCircleIcon } from "@/components/icons";
import { ThemeToggle } from "@/components/theme-toggle";
import { playBeep, playAlarm } from "@/lib/sounds";

const navItems = [
  { href: "/dashboard", label: "Dashboard", Icon: DashboardIcon },
  { href: "/meetings", label: "Meetings", Icon: GroupsIcon },
  { href: "/parking-lot", label: "Parking Lot", Icon: ParkingIcon },
  { href: "/executive-requests", label: "Exec Requests", Icon: PriorityHighIcon },
  { href: "/calendar", label: "Calendar", Icon: CalendarIcon },
  { href: "/notifications", label: "Notifications", Icon: NotificationsIcon },
  { href: "/admin", label: "Administration", Icon: AdminIcon },
];

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function HamburgerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="3" y1="5" x2="17" y2="5" />
      <line x1="3" y1="10" x2="17" y2="10" />
      <line x1="3" y1="15" x2="17" y2="15" />
    </svg>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data: user } = useCurrentUser();
  const { signOut } = useAuth();
  const { data: unreadData } = useUnreadCount();
  const { data: notifications } = useNotifications();
  const prevRef = useRef(0);
  const prevIdRef = useRef<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const handler = () => {
      try { new AudioContext().resume(); } catch {}
    };
    document.addEventListener("click", handler, { once: true });
    return () => document.removeEventListener("click", handler);
  }, []);

  useEffect(() => {
    const current = unreadData?.count ?? 0;
    if (current > prevRef.current) {
      const latest = notifications?.[0];
      if (latest && latest.id !== prevIdRef.current) {
        if (latest.type === "MEETING_REMINDER" || latest.type === "MEETING_CANCELLED") {
          playAlarm();
        } else {
          playBeep();
        }
        prevIdRef.current = latest.id;
      }
    }
    prevRef.current = current;
  }, [unreadData?.count, notifications]);

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  return (
    <div className="min-h-screen bg-background flex">
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside className={`fixed left-0 top-0 h-screen w-60 flex flex-col z-40 bg-surface-container-low border-r border-outline-variant/20 transition-transform duration-200 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"} md:translate-x-0`}>
        <div className="px-5 pt-6 pb-4">
          <h1 className="font-headline text-lg font-bold text-primary tracking-tight">Terra Meetings</h1>
          <p className="text-[10px] text-secondary font-semibold uppercase tracking-[0.2em] mt-0.5">Enterprise Suite</p>
        </div>

        <nav className="flex-1 px-3 space-y-0.5">
          {navItems.map((item) => {
            const isActive = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150 ${
                  isActive
                    ? "bg-primary/10 text-primary font-semibold"
                    : "text-secondary hover:text-on-surface hover:bg-surface-container-high/60"
                }`}
              >
                <item.Icon className="h-[18px] w-[18px] shrink-0" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="px-3 pb-4 space-y-3">
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <button
              onClick={() => { playBeep(); setTimeout(playAlarm, 600); }}
              className="p-2 rounded-lg text-secondary hover:text-on-surface hover:bg-surface-container-high/60 transition-all"
              title="Test notification sound (beep then alarm)"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
              </svg>
            </button>
          </div>
          {user && (
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-surface-container-high/40">
              <div className="w-8 h-8 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                {getInitials(user.name)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-on-surface truncate">{user.name}</p>
                <p className="text-[10px] text-secondary font-medium uppercase tracking-wider">{user.operationalRole}</p>
              </div>
              <button
                onClick={() => signOut()}
                className="text-[10px] text-secondary hover:text-error transition-colors font-medium shrink-0"
                title="Sign out"
              >
                Sign out
              </button>
            </div>
          )}
          <Link
            href="/meetings/new"
            className="w-full bg-primary text-primary-foreground py-3 px-4 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 hover:brightness-110 active:scale-[0.98] transition-all"
          >
            <PlusCircleIcon className="h-4 w-4" />
            Schedule Meeting
          </Link>
        </div>
      </aside>

      <main className="flex-1 min-h-screen ml-0 md:ml-60 overflow-x-hidden">
        <button
          onClick={() => setSidebarOpen(true)}
          className="fixed top-4 left-4 z-20 md:hidden p-2 rounded-lg bg-surface-container-low border border-outline-variant/20 text-on-surface shadow-md"
          aria-label="Open menu"
        >
          <HamburgerIcon />
        </button>
        <div className="pt-14 md:pt-0">{children}</div>
      </main>
    </div>
  );
}

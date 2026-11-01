import { Link, Outlet } from "react-router-dom";
import { Clapperboard } from "lucide-react";
import { NavLinks } from "@/components/nav-links";
import { LicenseBanner } from "./LicenseBanner";

export function AppShell() {
  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground antialiased">
      <aside className="hidden h-full w-56 shrink-0 flex-col border-r bg-surface-soft md:flex">
        <Link
          to="/projects"
          className="flex h-14 shrink-0 items-center gap-2 px-5 font-semibold"
        >
          <Clapperboard className="size-5" />
          <span>掘流</span>
        </Link>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
          <div className="px-2 pb-2 font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">
            Workspace
          </div>
          <NavLinks orientation="vertical" group="main" />
        </div>
        <div className="shrink-0 border-t p-3">
          <NavLinks orientation="vertical" group="settings" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <LicenseBanner />
        <main className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-0 lg:px-6 lg:pt-6 2xl:px-8">
          <Outlet />
        </main>
        <div className="shrink-0 border-t bg-background px-2 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] md:hidden">
          <NavLinks orientation="bottom" />
        </div>
      </div>
    </div>
  );
}

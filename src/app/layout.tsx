import type { Metadata } from "next";
import Link from "next/link";
import { Clapperboard } from "lucide-react";
import { NavLinks } from "@/components/nav-links";
import { GlobalJobsProvider } from "@/components/global-jobs-provider";
import { ConfirmProvider } from "@/components/confirm-dialog";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "掘流",
  description: "本地 AI 剧本与分镜提示词工作台 · 第三方素材回传",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" className="h-full">
      <body className="h-dvh overflow-hidden bg-background text-foreground antialiased">
        <ConfirmProvider>
          <GlobalJobsProvider>
            <div className="flex h-full">
              <aside className="hidden h-full w-56 shrink-0 flex-col border-r bg-surface-soft md:flex">
                <Link
                  href="/projects"
                  className="flex h-14 shrink-0 items-center gap-2 px-5 font-semibold"
                >
                  <Clapperboard className="size-5" />
                  <span>掘流</span>
                </Link>
                <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
                  <div className="px-2 pb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                    Workspace
                  </div>
                  <NavLinks orientation="vertical" group="main" />
                </div>
                <div className="shrink-0 border-t p-3">
                  <NavLinks orientation="vertical" group="settings" />
                </div>
              </aside>

              <div className="flex min-w-0 flex-1 flex-col">
                <header className="flex h-14 shrink-0 items-center justify-between border-b bg-background px-4 md:hidden">
                  <Link
                    href="/projects"
                    className="flex items-center gap-2 font-semibold"
                  >
                    <Clapperboard className="size-5" />
                    <span>掘流</span>
                  </Link>
                  <div className="flex items-center gap-2">
                    <NavLinks />
                  </div>
                </header>
                <main className="min-h-0 flex-1 overflow-y-auto px-4 pt-6 pb-0 lg:px-6 2xl:px-8">
                  {children}
                </main>
              </div>
            </div>
            <Toaster />
          </GlobalJobsProvider>
        </ConfirmProvider>
      </body>
    </html>
  );
}

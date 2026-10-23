import type { Metadata } from "next";
import Link from "next/link";
import { Clapperboard } from "lucide-react";
import { NavLinks } from "@/components/nav-links";
import { GlobalJobsButton } from "@/components/global-jobs";
import { ConfirmProvider } from "@/components/confirm-dialog";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "掘漫",
  description: "本地 AI 漫剧创作工作台 · 内置云端生成",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" className="h-full">
      <body className="h-dvh overflow-hidden bg-background text-foreground antialiased">
        <ConfirmProvider>
          <div className="flex h-full">
            <aside className="hidden h-full w-56 shrink-0 flex-col border-r bg-surface-soft md:flex">
              <Link
                href="/projects"
                className="flex h-14 shrink-0 items-center gap-2 px-5 font-semibold"
              >
                <Clapperboard className="size-5" />
                <span>掘漫</span>
              </Link>
              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
                <div className="px-2 pb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  Workspace
                </div>
                <NavLinks orientation="vertical" />
              </div>
              <div className="shrink-0 border-t p-3">
                <GlobalJobsButton align="left" side="top" block />
              </div>
            </aside>

            <div className="flex min-w-0 flex-1 flex-col">
              <header className="flex h-14 shrink-0 items-center justify-between border-b bg-background px-4 md:hidden">
                <Link
                  href="/projects"
                  className="flex items-center gap-2 font-semibold"
                >
                  <Clapperboard className="size-5" />
                  <span>掘漫</span>
                </Link>
                <div className="flex items-center gap-2">
                  <GlobalJobsButton />
                  <NavLinks />
                </div>
              </header>
              <main className="min-h-0 flex-1 overflow-y-auto px-4 pt-6 pb-0 lg:px-6 2xl:px-8">
                {children}
              </main>
            </div>
          </div>
          <Toaster />
        </ConfirmProvider>
      </body>
    </html>
  );
}

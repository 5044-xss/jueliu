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
      <body className="min-h-full flex flex-col bg-background text-foreground antialiased">
        <ConfirmProvider>
          <header className="sticky top-0 z-50 border-b bg-background">
            <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4">
              <Link href="/projects" className="flex items-center gap-2 font-semibold">
                <Clapperboard className="size-5" />
                <span>掘漫</span>
              </Link>
              <div className="flex items-center gap-3">
                <GlobalJobsButton />
                <span className="h-5 w-px bg-border" />
                <NavLinks />
              </div>
            </div>
          </header>
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-0">
            {children}
          </main>
          <Toaster />
        </ConfirmProvider>
      </body>
    </html>
  );
}

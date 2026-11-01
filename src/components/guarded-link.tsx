"use client";

import type { ComponentProps } from "react";
import { useRouter } from "@/spa/compat/navigation";
import Link from "@/spa/compat/link";
import { useConfirm } from "@/components/confirm-dialog";
import { hasUnsavedChanges } from "@/lib/unsaved-guard";

// 带「未保存修改」拦截的 Link：有改动时先弹出确认，确认后再跳转。
export function GuardedLink({
  onClick,
  skipGuard,
  href,
  ...props
}: ComponentProps<typeof Link> & { skipGuard?: boolean }) {
  const confirm = useConfirm();
  const router = useRouter();

  return (
    <Link
      {...props}
      href={href}
      onClick={async (event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        // 新窗口/新标签打开不丢失当前页面状态，无需拦截。
        if (
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          event.button !== 0
        ) {
          return;
        }
        if (skipGuard || !hasUnsavedChanges()) return;

        event.preventDefault();
        const ok = await confirm({
          title: "放弃未保存的修改？",
          description: "当前页面有未保存的修改，离开后将会丢失。",
          confirmText: "放弃并离开",
          destructive: true,
        });
        if (ok) router.push(href as Parameters<typeof router.push>[0]);
      }}
    />
  );
}

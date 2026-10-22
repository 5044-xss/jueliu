"use client";

import { ArrowRight } from "lucide-react";
import { cn } from "@core/client/utils";
import { GuardedLink } from "@/components/guarded-link";
import { buttonVariants } from "@/components/ui/button";

// 线性流程（故事→剧本→资产→分镜→合成）的「下一步」入口。
export function NextStepLink({ href, label }: { href: string; label: string }) {
  return (
    <GuardedLink
      href={href}
      className={cn(buttonVariants({ variant: "outline" }))}
    >
      {label}
      <ArrowRight className="size-4" />
    </GuardedLink>
  );
}

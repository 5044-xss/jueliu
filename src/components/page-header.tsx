import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const ACCENTS = {
  lilac: "bg-block-lilac",
  lime: "bg-block-lime",
  cream: "bg-block-cream",
  mint: "bg-block-mint",
  pink: "bg-block-pink",
  coral: "bg-block-coral",
} as const;

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  accent = "lilac",
}: {
  eyebrow: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  accent?: keyof typeof ACCENTS;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className={cn("size-2.5 rounded-full", ACCENTS[accent])} />
          <span className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">
            {eyebrow}
          </span>
        </div>
        <h1 className="text-2xl font-light tracking-[-0.5px]">{title}</h1>
        {description && (
          <div className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {description}
          </div>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

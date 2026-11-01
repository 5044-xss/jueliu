import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "cn";

const TONE: Record<string, string> = {
  lime: "bg-block-lime",
  lilac: "bg-block-lilac",
  mint: "bg-block-mint",
  pink: "bg-block-pink",
  cream: "bg-block-cream",
  muted: "bg-muted text-muted-foreground",
};

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  tone = "muted",
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  tone?: keyof typeof TONE;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2.5 rounded-2xl border bg-card px-4 py-9 text-center sm:gap-3 sm:px-5 sm:py-14",
        className,
      )}
    >
      {Icon && (
        <div
          className={cn(
            "flex size-12 items-center justify-center rounded-full",
            TONE[tone],
          )}
        >
          <Icon className="size-5" />
        </div>
      )}
      <div>
        <p className="font-medium">{title}</p>
        {description && (
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

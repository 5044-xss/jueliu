"use client";

import { useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@core/client/utils";

export const PREVIEW_THUMB_CLASS =
  "relative overflow-hidden rounded-lg border bg-black";

export const PREVIEW_CHIP_CLASS =
  "rounded bg-black/65 px-1 py-0.5 text-[10px] leading-3 text-white";

export function PreviewDialog({
  open,
  onOpenChange,
  title,
  description,
  footer,
  mediaClassName,
  className,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  footer?: ReactNode;
  mediaClassName?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "gap-0 overflow-hidden border bg-white p-0 text-neutral-900 sm:max-w-5xl",
          className,
        )}
      >
        <DialogHeader className="gap-1 border-b px-4 py-3 pr-12">
          <DialogTitle className="text-sm text-neutral-900">
            {title}
          </DialogTitle>
          {description ? (
            <DialogDescription className="text-xs text-neutral-500">
              {description}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <div
          className={cn(
            "flex max-h-[74vh] items-center justify-center overflow-hidden bg-white p-4",
            mediaClassName,
          )}
        >
          {children}
        </div>
        {footer ? (
          <div className="flex flex-wrap items-center gap-1.5 border-t px-4 py-3">
            {footer}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function PreviewImage({
  src,
  alt,
  title,
  description,
  className,
  imgClassName,
}: {
  src: string;
  alt: string;
  title?: string;
  description?: ReactNode;
  className?: string;
  imgClassName?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <img
        src={src}
        alt={alt}
        title={title ?? alt}
        onClick={() => setOpen(true)}
        className={cn("cursor-zoom-in", className)}
      />
      <PreviewDialog
        open={open}
        onOpenChange={setOpen}
        title={title ?? alt}
        description={description}
      >
        <img
          src={src}
          alt={alt}
          className={cn(
            "max-h-[66vh] w-auto max-w-full rounded-md object-contain shadow-sm ring-1 ring-black/5",
            imgClassName,
          )}
        />
      </PreviewDialog>
    </>
  );
}

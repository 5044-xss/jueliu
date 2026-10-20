"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@core/client/utils";

export function PreviewImage({
  src,
  alt,
  title,
  className,
  imgClassName,
}: {
  src: string;
  alt: string;
  title?: string;
  className?: string;
  imgClassName?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        title={title ?? alt}
        onClick={() => setOpen(true)}
        className={cn("cursor-zoom-in", className)}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-auto max-w-[92vw] p-3 sm:max-w-[92vw]">
          <DialogTitle className="sr-only">{title ?? alt}</DialogTitle>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            className={cn(
              "max-h-[85vh] max-w-[88vw] rounded-md object-contain",
              imgClassName,
            )}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

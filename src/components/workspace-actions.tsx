"use client";

import {
  useState,
  useSyncExternalStore,
  type ComponentProps,
} from "react";
import { FolderOpen, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type ButtonProps = Pick<
  ComponentProps<typeof Button>,
  "variant" | "size" | "className"
> & { label?: string };

const noopSubscribe = () => () => {};
const getSnapshot = () => Boolean(window.licenseAPI || window.desktopAPI);
const getServerSnapshot = () => false;

function useDesktopApi() {
  const available = useSyncExternalStore(
    noopSubscribe,
    getSnapshot,
    getServerSnapshot,
  );
  return available ? window.licenseAPI ?? null : null;
}

type SpaTarget =
  | { kind: "root" }
  | { kind: "project"; projectId: string; subpath?: string }
  | { kind: "reveal"; relativePath: string };

function WorkspaceButton({
  target,
  spaTarget,
  label,
  variant = "outline",
  size = "sm",
  className,
}: { target?: string; spaTarget?: SpaTarget } & ButtonProps) {
  const api = useDesktopApi();
  const media = window.desktopAPI?.media;
  const [busy, setBusy] = useState(false);

  if (!api && !media) return null;

  async function onClick() {
    if ((!api && !media) || busy) return;
    setBusy(true);
    try {
      let result: { ok: boolean; error?: string } | undefined;
      if (window.__JUELIU_SPA__ && media && spaTarget) {
        if (spaTarget.kind === "root") {
          result = await media.openRoot();
        } else if (spaTarget.kind === "reveal") {
          result = await media.reveal(spaTarget.relativePath);
        } else {
          result = await media.openFolder({
            projectId: spaTarget.projectId,
            subpath: spaTarget.subpath,
          });
        }
      } else if (api) {
        result = target
          ? await api.revealPath(target)
          : await api.openWorkspace();
      }
      if (result && !result.ok) {
        toast.error(result.error || "打开失败");
      }
    } catch (error) {
      toast.error((error as Error).message || "打开失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      onClick={onClick}
      disabled={busy}
      title={target ? "在系统文件管理器中显示" : "打开本地工作区目录"}
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <FolderOpen className="size-4" />
      )}
      {label}
    </Button>
  );
}

export function OpenWorkspaceButton(props: ButtonProps) {
  return (
    <WorkspaceButton
      label="打开工作区"
      spaTarget={{ kind: "root" }}
      {...props}
    />
  );
}

export function OpenProjectFolderButton({
  projectId,
  ...props
}: { projectId: string } & ButtonProps) {
  return (
    <WorkspaceButton
      target={projectId}
      label="打开文件夹"
      spaTarget={{ kind: "project", projectId }}
      {...props}
    />
  );
}

export function OpenExportsFolderButton({
  projectId,
  ...props
}: { projectId: string } & ButtonProps) {
  return (
    <WorkspaceButton
      target={`${projectId}/media/exports`}
      label="打开成片文件夹"
      spaTarget={{ kind: "project", projectId, subpath: "exports" }}
      {...props}
    />
  );
}

export function RevealExportButton({
  projectId,
  compositionId,
  ...props
}: { projectId: string; compositionId: string } & ButtonProps) {
  return (
    <WorkspaceButton
      target={`${projectId}/media/exports/${compositionId}.mp4`}
      label="在文件夹中显示"
      spaTarget={{ kind: "project", projectId, subpath: "exports" }}
      {...props}
    />
  );
}

import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function LoadingState({ label = "加载中…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      {label}
    </div>
  );
}

export function LoadErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <Card className="border-destructive/30 bg-destructive/5">
      <CardContent className="flex flex-wrap items-center gap-3 py-6 text-sm">
        <AlertTriangle className="size-4 shrink-0 text-destructive" />
        <span className="text-destructive">{message}</span>
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RefreshCw className="size-3.5" />
          重试
        </Button>
      </CardContent>
    </Card>
  );
}

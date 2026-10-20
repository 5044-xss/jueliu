import { Card, CardContent } from "@/components/ui/card";

export function ComingSoon({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-medium">{title}</h2>
        <p className="text-sm text-muted-foreground">{note}</p>
      </div>
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          该模块尚未实现。
        </CardContent>
      </Card>
    </div>
  );
}

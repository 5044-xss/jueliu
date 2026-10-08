import { LibraryTabs } from "@/components/library-tabs";
import { PageHeader } from "@/components/page-header";

export default function LibraryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Library"
        accent="lime"
        title="资源库"
        description="全局可复用资源：风格预设、各厂商提示词模板、技能提示词。保存在 workspace/library/。"
      />
      <div className="sticky top-14 z-40 -mx-4 bg-background px-4">
        <LibraryTabs />
      </div>
      {children}
    </div>
  );
}

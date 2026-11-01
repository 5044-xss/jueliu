import { LibraryTabs } from "@/components/library-tabs";
import { PageHeader } from "@/components/page-header";

export default function LibraryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-6">
      <PageHeader
        eyebrow="Library"
        accent="lime"
        title="资源库"
        description="全局可复用资源：资产参考图、风格预设与技能提示词。保存在本机浏览器本地。"
      />
      <div className="sticky top-0 z-40 -mx-4 shrink-0 bg-background px-4 lg:-mx-6 lg:px-6 2xl:-mx-8 2xl:px-8">
        <LibraryTabs />
      </div>
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-6">
        {children}
      </div>
    </div>
  );
}

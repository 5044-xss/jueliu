import { AssetLibraryBrowser } from "@/components/asset-library-browser";

export default function LibraryAssetsPage() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <p className="shrink-0 text-sm text-muted-foreground">
        在项目「资产」页可把已回传的角色 / 场景 / 道具 / 妆造图「入库」到全局，供所有剧复用。
      </p>
      <AssetLibraryBrowser scope="global" fill />
    </div>
  );
}

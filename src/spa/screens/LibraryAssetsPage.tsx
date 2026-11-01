import { AssetLibraryBrowser } from "@/components/asset-library-browser";

export default function LibraryAssetsPage() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <p className="shrink-0 text-sm text-muted-foreground">
        全局资产库跨所有项目复用。项目内的共享素材见项目页「项目资产库」；在项目「资产」页可把已回传的角色 / 场景 / 道具 / 妆造图入库。
      </p>
      <AssetLibraryBrowser scope="global" fill />
    </div>
  );
}

// 跨组件的「未保存修改」守卫：故事页等在有改动时注册一个查询函数，
// 导航组件（标签页 / 面包屑 / 顶栏）在跳转前询问，避免静默丢失改动。
let active: (() => boolean) | null = null;

export function setUnsavedGuard(fn: (() => boolean) | null): void {
  active = fn;
}

export function hasUnsavedChanges(): boolean {
  return active ? active() : false;
}

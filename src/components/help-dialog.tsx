"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const FLOW = [
  {
    title: "故事",
    body: "写下原始故事，可以加额外要求。",
  },
  {
    title: "剧本",
    body: "点「生成剧本」，得到分场剧本；不满意可以逐场改。",
  },
  {
    title: "资产",
    body: "点「生成资产」，提取角色、场景、道具；再生成参考图（云端出图或上传）。",
  },
  {
    title: "分镜",
    body: "点「生成分镜」；逐段看提示词，生成起始画面或视频，或回传外部素材。编译后的提示词和校验结果在「分镜执行记录」。",
  },
  {
    title: "合成",
    body: "选段、排序、设转场和字幕，点「合成导出」；完成后打开成片文件夹。",
  },
];

const MODES = [
  {
    label: "全自动",
    body: "云端出图 + 云端出片，需要图片、视频连接。",
  },
  {
    label: "半自动",
    body: "图片云端出，视频去第三方生成后回传。",
  },
  {
    label: "全手动",
    body: "图片、视频都在第三方生成，再分别回传到资产视角和分镜段落。",
  },
];

const FAQ = [
  {
    problem: "按钮是灰的，或提示未配置",
    fix: "先配文本 Key，或补上一步产物（没剧本不能生成资产、分镜）。",
  },
  {
    problem: "401、额度不足、超时",
    fix: "设置 → 服务商 → 测试连接；模型路由换模型；任务页看失败原因。",
  },
  {
    problem: "出图、出片一直排队",
    fix: "任务页看进度，也可以取消；云端排队时等待即可。",
  },
  {
    problem: "合成报 ffmpeg 不可用",
    fix: "设置 → 本机 → 检测或填路径。",
  },
  {
    problem: "找不到生成的文件",
    fix: "项目页「打开文件夹」，合成页「打开成片文件夹」。",
  },
];

export function HelpDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>使用说明</DialogTitle>
          <DialogDescription>第一次用按顺序走；卡住了看最后一段。</DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto pr-2">
          <div className="flex flex-col gap-6 pb-1">
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">开始前</h3>
              <ul className="flex flex-col gap-1.5 leading-relaxed">
                <li>
                  <span className="font-medium">文本模型（必须）</span>
                  ：设置 → 服务商 → 添加服务商，选一个支持「文本」的连接并填入
                  Key；再到「模型路由」确认「文本」已选中模型。没配好时，剧本、资产、分镜都生成不了。
                </li>
                <li>
                  <span className="font-medium">ffmpeg（合成前必须）</span>
                  ：设置 → 本机 → 检测。打包版一般已内置；只生成、不合成可以先跳过。
                </li>
                <li>
                  <span className="font-medium">图片 / 视频模型（可选）</span>
                  ：想用内置云端出图、出片，就在「服务商」添加对应连接，并在「模型路由」绑定；不配也能走手动回传。
                </li>
              </ul>
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">主线：五个页面</h3>
              <p className="leading-relaxed">
                新建项目后，按 故事 → 剧本 → 资产 → 分镜 → 合成 走一遍。一个项目可以有多集，每集各自走一遍。
              </p>
              <ol className="flex flex-col gap-2">
                {FLOW.map((step, index) => (
                  <li key={step.title} className="flex gap-2.5">
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium">
                      {index + 1}
                    </span>
                    <p className="leading-relaxed">
                      <span className="font-medium">{step.title}</span>：
                      {step.body}
                    </p>
                  </li>
                ))}
              </ol>
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">图片和视频从哪来</h3>
              <ul className="flex flex-col gap-1.5 leading-relaxed">
                {MODES.map((mode) => (
                  <li key={mode.label} className="flex gap-2">
                    <span className="w-14 shrink-0 font-medium">
                      {mode.label}
                    </span>
                    <span className="text-muted-foreground">{mode.body}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                合成和导出始终在本机完成。
              </p>
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">卡住了</h3>
              <ul className="flex flex-col gap-1.5 leading-relaxed">
                {FAQ.map((item) => (
                  <li key={item.problem}>
                    <span className="font-medium">{item.problem}</span>
                    <span className="text-muted-foreground">：{item.fix}</span>
                  </li>
                ))}
              </ul>
            </section>

            <p className="border-t pt-3 text-xs leading-relaxed text-muted-foreground">
              API Key 自备、按量自费；项目与素材保存在本机工作区。
            </p>
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>关闭</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

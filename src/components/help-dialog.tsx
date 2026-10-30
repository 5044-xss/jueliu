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
    body: "点「生成资产」，提取角色、场景、道具；复制提示词到第三方出图，再回传到资产视角。",
  },
  {
    title: "分镜",
    body: "点「生成分镜」；逐段复制提示词到第三方生成视频，再回传到对应段落。",
  },
  {
    title: "合成",
    body: "选段、排序、设转场和字幕，点「合成导出」；完成后打开成片文件夹。",
  },
];

const FAQ = [
  {
    problem: "按钮是灰的，或提示未配置",
    fix: "先配文本 Key，或补上一步产物（没剧本不能生成资产、分镜）。",
  },
  {
    problem: "401、额度不足、超时",
    fix: "设置 → 服务商 → 测试连接；模型路由换模型。",
  },
  {
    problem: "图片或视频回传后没显示",
    fix: "确认文件格式受支持（图片 PNG/JPG，视频 MP4/WebM/MOV），并刷新页面。",
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
                  <span className="font-medium">图片 / 视频（手动回传）</span>
                  ：在第三方平台按提示词生成，再回传到资产视角和分镜段落。
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
              <p className="leading-relaxed">
                图片与视频都在第三方平台生成，再分别回传到资产视角和分镜段落。合成和导出在本机完成。
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

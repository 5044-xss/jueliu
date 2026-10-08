import Link from "next/link";
import { ArrowRight, Film, KeyRound, Settings2, Wand2, Clapperboard } from "lucide-react";

const STEPS = [
  { icon: Settings2, title: "配置模型", body: "在设置里填写你自己的 LLM API Key，按量自费。" },
  { icon: Wand2, title: "生成提示词", body: "按项目生成剧本、分镜，以及画面与视频提示词。" },
  { icon: Film, title: "出图出片", body: "把提示词交给第三方图像 / 视频模型生成素材。" },
  { icon: Clapperboard, title: "合成导出", body: "素材导入项目，用内置 ffmpeg 合成并导出成片。" },
];

const PREPARE = [
  "一个可用的 LLM API Key（自备，按量自费）",
  "第三方图像 / 视频模型账号（出图出片，费用与质量由该服务决定）",
  "ffmpeg —— 已随软件内置，无需单独安装",
];

const MYTHS = [
  { wrong: "点一下就能直接出片", right: "软件产出的是提示词，出片要靠第三方模型" },
  { wrong: "软件自带模型额度", right: "Key 与额度都由你自己提供" },
  { wrong: "还要自己装 ffmpeg", right: "已内置，开箱即用" },
];

export default function HelpPage() {
  return (
    <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-24 py-4 text-black">
      <section className="flex flex-col gap-6 pt-6">
        <p className="font-mono text-xs uppercase tracking-[0.14em]">使用须知 · GUIDE</p>
        <h1 className="max-w-3xl text-4xl font-light leading-[1.1] tracking-[-0.9px] sm:text-5xl">
          先看懂这页，再开始创作。
        </h1>
        <p className="max-w-2xl text-lg leading-relaxed tracking-[-0.14px]">
          掘漫是本地单机工作台：管项目、生成提示词、合成成片。它
          <strong className="font-semibold">不直接生成视频</strong>
          ——出图出片交给第三方模型，换哪家、用哪版，都由你决定。
        </p>
      </section>

      <section className="rounded-[24px] bg-[#c5b0f4] p-8 sm:p-12">
        <p className="font-mono text-xs uppercase tracking-[0.14em]">重要</p>
        <h2 className="mt-4 max-w-2xl text-2xl font-medium leading-snug tracking-[-0.26px]">
          掘漫不直接生成成片视频
        </h2>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed tracking-[-0.14px]">
          它产出的是
          <strong className="font-semibold">剧本、分镜，以及画面与视频的提示词</strong>。
          真正的出图、出片，需要你到第三方模型（可灵、即梦、Runway、Midjourney 等）完成，
          再把素材带回本软件合成为成片。
        </p>
        <p className="mt-4 max-w-2xl text-base leading-relaxed">
          好处是完全不绑定模型：成本与画质，始终由你自己掌控。
        </p>
      </section>

      <section className="rounded-[24px] bg-[#dceeb1] p-8 sm:p-12">
        <p className="font-mono text-xs uppercase tracking-[0.14em]">工作流程</p>
        <h2 className="mt-4 text-2xl font-medium tracking-[-0.26px]">四步走完一条漫剧</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {STEPS.map((step, index) => (
            <div
              key={step.title}
              className="flex items-start gap-4 rounded-[16px] bg-white/70 p-6"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-black text-sm font-medium text-white">
                {index + 1}
              </span>
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <step.icon className="size-4" />
                  <span className="font-medium">{step.title}</span>
                </div>
                <p className="text-sm leading-relaxed">{step.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-[24px] bg-[#f4ecd6] p-8 sm:p-12">
        <p className="font-mono text-xs uppercase tracking-[0.14em]">准备</p>
        <h2 className="mt-4 text-2xl font-medium tracking-[-0.26px]">开工前准备好</h2>
        <div className="mt-8 flex flex-col gap-4">
          {PREPARE.map((item) => (
            <div key={item} className="flex items-start gap-3">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-semibold">
                ✓
              </span>
              <span className="text-base leading-relaxed">{item}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-[24px] bg-[#c8e6cd] p-8 sm:p-12">
        <p className="font-mono text-xs uppercase tracking-[0.14em]">澄清</p>
        <h2 className="mt-4 text-2xl font-medium tracking-[-0.26px]">常见误解</h2>
        <div className="mt-8 flex flex-col gap-3">
          {MYTHS.map((item) => (
            <div
              key={item.wrong}
              className="grid items-start gap-3 rounded-[16px] bg-white/70 p-5 sm:grid-cols-2"
            >
              <div className="flex items-start gap-2 text-sm">
                <span className="font-mono text-xs uppercase tracking-widest">×</span>
                <span className="text-black/45 line-through decoration-black/30">
                  {item.wrong}
                </span>
              </div>
              <div className="flex items-start gap-2 text-sm">
                <span className="font-mono text-xs uppercase tracking-widest">✓</span>
                <span className="font-medium">{item.right}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col items-start gap-6 pb-8">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/settings"
            className="inline-flex items-center gap-2 rounded-full bg-black px-5 py-2.5 text-[15px] font-medium text-white transition-opacity hover:opacity-85"
          >
            去填写 API Key
            <ArrowRight className="size-4" />
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-5 py-2.5 text-[15px] font-medium transition-colors hover:bg-black/5"
          >
            开始创建项目
          </Link>
        </div>
        <p className="flex items-center gap-2 text-sm">
          <KeyRound className="size-3.5" />
          你的 API Key 只保存在本机工作区，不会上传。
        </p>
      </section>
    </div>
  );
}

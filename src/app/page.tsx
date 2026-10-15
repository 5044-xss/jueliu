import Link from "next/link";
import {
  ArrowRight,
  Clapperboard,
  Film,
  ImagePlus,
  KeyRound,
  Settings2,
  Wand2,
} from "lucide-react";

const FREE_ROUTE = [
  {
    icon: Settings2,
    title: "写提示词 · 阿里百炼",
    body: "注册即有免费额度，qwen 系列足够生成海量提示词，不花钱。",
  },
  {
    icon: ImagePlus,
    title: "生图 · 豆包 / 即梦",
    body: "日常免费额度，角色、场景出图够用。",
  },
  {
    icon: Film,
    title: "生视频 · 豆包",
    body: "可用免费额度生成视频片段。",
  },
];

const STEPS = [
  { icon: Settings2, title: "配置模型", body: "填入你自己的 LLM Key；阿里百炼新用户有免费额度。" },
  { icon: Wand2, title: "生成提示词", body: "生成剧本、分镜，以及画面与视频提示词。" },
  { icon: Film, title: "出图出片", body: "把提示词交给豆包 / 即梦等模型生成素材。" },
  { icon: Clapperboard, title: "合成导出", body: "素材导入项目，用内置 ffmpeg 合成成片。" },
];

const MYTHS = [
  { wrong: "做漫剧要花很多钱", right: "用各平台的免费额度，起步阶段几乎零成本" },
  { wrong: "软件自带模型额度", right: "额度来自你自己的账号，多数平台都有免费额度" },
  { wrong: "点一下就能直接出片", right: "软件产出提示词，出片交给免费模型" },
];

export default function HomePage() {
  return (
    <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-24 py-4 text-black">
      <section className="flex flex-col gap-6 pt-6">
        <p className="font-mono text-xs uppercase tracking-[0.14em]">掘流 · HOME</p>
        <h1 className="max-w-3xl text-4xl font-light leading-[1.1] tracking-[-0.9px] sm:text-5xl">
          用免费额度，做出你的第一条漫剧。
        </h1>
        <p className="max-w-2xl text-lg leading-relaxed tracking-[-0.14px]">
          掘流是一款本地单机的 AI 漫剧创作工作台。它负责管项目、生成提示词、合成成片；出图出片交给第三方模型——
          <strong className="font-semibold">其中不少是免费的</strong>
          。全流程几乎零成本就能跑起来。
        </p>
      </section>

      <section className="rounded-[24px] bg-[#c5b0f4] p-8 sm:p-12">
        <p className="font-mono text-xs uppercase tracking-[0.14em]">重要</p>
        <h2 className="mt-4 max-w-2xl text-2xl font-medium leading-snug tracking-[-0.26px]">
          掘流不直接生成成片视频
        </h2>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed tracking-[-0.14px]">
          它产出的是
          <strong className="font-semibold">剧本、分镜，以及画面与视频的提示词</strong>。
          出图、出片到第三方模型完成，再把素材带回本软件合成为成片。
        </p>
        <p className="mt-4 max-w-2xl text-base leading-relaxed">
          好处是不绑定任何一家模型——你还能挑免费的那家用。
        </p>
      </section>

      <section className="rounded-[24px] bg-[#dceeb1] p-8 sm:p-12">
        <p className="font-mono text-xs uppercase tracking-[0.14em]">省钱路线</p>
        <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-5xl font-light tracking-[-1px]">≈ ¥0</span>
          <span className="text-base">起步成本，用免费额度就能跑通</span>
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {FREE_ROUTE.map((item) => (
            <div key={item.title} className="flex flex-col gap-3 rounded-[16px] bg-white/70 p-6">
              <span className="flex size-9 items-center justify-center rounded-full bg-black text-white">
                <item.icon className="size-4" />
              </span>
              <span className="font-medium">{item.title}</span>
              <p className="text-sm leading-relaxed">{item.body}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-xs leading-relaxed">
          * 各平台免费额度、可用模型以其官方最新规则为准。
        </p>
      </section>

      <section className="rounded-[24px] bg-[#f4ecd6] p-8 sm:p-12">
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
            href="/projects"
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

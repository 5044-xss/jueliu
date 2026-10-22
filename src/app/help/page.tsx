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

const MODES = [
  {
    icon: ImagePlus,
    title: "内置云端出图",
    body: "配置 Toapi 后，在资产页直接出图；会带上参考资产图，保持角色、场景一致。",
  },
  {
    icon: Film,
    title: "内置云端出片",
    body: "接入自建 ComfyUI（MiniMax H3），按分镜逐段生成视频，再拼成整条成片。",
  },
  {
    icon: Wand2,
    title: "第三方手动回传",
    body: "把提示词交给豆包 / 即梦等平台生成，再把图片、视频回传到对应段落——可用免费额度。",
  },
];

const STEPS = [
  {
    icon: Settings2,
    title: "写故事 · 配置模型",
    body: "写下原始故事，并在设置里填入自己的 LLM Key（默认阿里百炼，兼容 OpenAI 接口）。",
  },
  {
    icon: Wand2,
    title: "生成剧本 · 资产 · 分镜",
    body: "AI 把故事拆成分场剧本，提取角色 / 场景 / 道具资产，并生成逐镜分镜。",
  },
  {
    icon: ImagePlus,
    title: "出图 · 出片",
    body: "走内置云端接口一键生成，或把编译好的提示词交给第三方平台生成后回传。",
  },
  {
    icon: Clapperboard,
    title: "合成导出",
    body: "选段排序、设置转场，用内置 ffmpeg 合成成片并导出到本地。",
  },
];

const MYTHS = [
  { wrong: "必须把项目上传到云端", right: "项目、素材与密钥都保存在本机工作区" },
  { wrong: "只能用某一家模型", right: "LLM 与出图 / 出片模型都可自选，按量自费" },
  { wrong: "提示词和画面要手动拼", right: "提示词自动编译，成片由内置 ffmpeg 合成" },
];

export default function HelpPage() {
  return (
    <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-24 py-4 text-black">
      <section className="flex flex-col gap-6 pt-6">
        <p className="font-mono text-xs uppercase tracking-[0.14em]">
          掘漫 · HELP
        </p>
        <h1 className="max-w-3xl text-4xl font-light leading-[1.1] tracking-[-0.9px] sm:text-5xl">
          把一条漫剧，从一个故事做成成片。
        </h1>
        <p className="max-w-2xl text-lg leading-relaxed tracking-[-0.14px]">
          掘漫是一款本地单机的 AI 漫剧创作工作台。它把「故事 → 剧本 → 资产 → 分镜 →
          成片」串成一条流水线：提示词由你自己配置的 LLM 生成，画面与视频既可以走
          <strong className="font-semibold">内置云端接口</strong>
          ，也可以交给任意第三方平台生成后再把素材带回来合成。
        </p>
      </section>

      <section className="rounded-[24px] bg-[#c5b0f4] p-8 sm:p-12">
        <p className="font-mono text-xs uppercase tracking-[0.14em]">重要</p>
        <h2 className="mt-4 max-w-2xl text-2xl font-medium leading-snug tracking-[-0.26px]">
          掘漫帮你把整条流程串起来
        </h2>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed tracking-[-0.14px]">
          从故事自动生成
          <strong className="font-semibold">
            结构化剧本、角色 / 场景 / 道具资产，以及逐镜分镜
          </strong>
          。画面与视频既能由内置云端接口生成，也支持把提示词交给第三方平台生成后回传。
        </p>
        <p className="mt-4 max-w-2xl text-base leading-relaxed">
          项目、素材与密钥都存在本机，模型不绑定任何一家——也可以挑免费的那家用。
        </p>
      </section>

      <section className="rounded-[24px] bg-[#dceeb1] p-8 sm:p-12">
        <p className="font-mono text-xs uppercase tracking-[0.14em]">
          出图出片的三种方式
        </p>
        <h2 className="mt-4 text-2xl font-medium tracking-[-0.26px]">
          想省事就用内置，想省钱就手动回传
        </h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {MODES.map((item) => (
            <div
              key={item.title}
              className="flex flex-col gap-3 rounded-[16px] bg-white/70 p-6"
            >
              <span className="flex size-9 items-center justify-center rounded-full bg-black text-white">
                <item.icon className="size-4" />
              </span>
              <span className="font-medium">{item.title}</span>
              <p className="text-sm leading-relaxed">{item.body}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-xs leading-relaxed">
          * 内置云端出图 / 出片按模型用量计费，费用在各平台账户结算；第三方平台的免费额度以其官方最新规则为准。
        </p>
      </section>

      <section className="rounded-[24px] bg-[#f4ecd6] p-8 sm:p-12">
        <p className="font-mono text-xs uppercase tracking-[0.14em]">工作流程</p>
        <h2 className="mt-4 text-2xl font-medium tracking-[-0.26px]">
          四步走完一条漫剧
        </h2>
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
            href="/settings#llm"
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

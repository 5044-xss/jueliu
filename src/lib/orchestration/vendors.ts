// 厂商能力档案：类型 + 内置默认值。
// 纯数据、不读写文件，便于被服务端与资源库共用。
// 用户可编辑的真实档案存于资源库（workspace/library/vendors.json），见 @/lib/library/vendors。
export type VendorId = string;

export interface VendorProfile {
  id: string;
  name: string;
  /** 一次生成的提示词模板平台（对应模板库 platform）。 */
  platform: string;
  /** 一次调用最多几个分镜（multi-shot 上限；1 = 只能单镜）。 */
  maxShotsPerSegment: number;
  /** 是否支持段内多镜（false 时强制 per-shot）。 */
  supportMultiShot: boolean;
  /** 参考图槽位上限（含场景）。超出者降级为文本锚点并告警。 */
  maxRefImages: number;
  /** 单次生成时长下限（毫秒）。 */
  minSegmentMs: number;
  /** 单次生成时长上限（毫秒）。 */
  maxSegmentMs: number;
  /** 时长档位步进（毫秒）。0 = 连续，可任意时长。 */
  durationStepMs: number;
  /** 是否支持首帧（图生视频 / 首帧锚定）。 */
  supportFirstFrame: boolean;
  /** 是否支持尾帧。 */
  supportLastFrame: boolean;
  /** 一句话说明，供 UI 展示。 */
  note: string;
  /** 该厂商专属的「AI 翻译提示词」：把渲染出的正文编译成本厂商可执行的提示词。 */
  compilePrompt: string;
}

export const DEFAULT_VENDOR: VendorId = "doubao";

// 通用兜底翻译提示词：把「人可读的分镜提示词」编译成 AI 图/视频可执行提示词。
// 未配置 compilePrompt 的厂商用它。
export const DEFAULT_GENERIC_COMPILE_PROMPT = `你是「分镜提示词 AI 化编译器」。用户会给你一份「给人看的分镜提示词」，你要把它改写成 AI 图/视频生成可直接执行的提示词。

【硬性保持】剧情、台词、分镜顺序、时长、镜头焦段、机位方向保持不变；只做可执行性修复与规范化，不得增删剧情、不得改变分镜数量。
【只允许修复】参考图绑定、轴线、灯光、动作可行性、表情矛盾、画外音、竖屏构图、负面约束。
【全局优先级】角色一致性 > 场景一致性 > 光线连续性 > 风格统一 > 构图美观。

【输出格式】只输出下面这段文本本身，不要任何解释、前言、后缀或代码块标记：
【基础设定】
……
【角色一致性｜全局硬约束】
图X=角色名（服装·四视图）
角色名：全程保持图X中的脸型、发型、发色、服装、体型、配饰、妆容完全一致。
【空间与站位（锁定）】
……
【灯光连续性】
……
【分镜序列】
分镜1（时长）：
镜头：景别，焦段，角度，运动，机位。
画面：……
画面内：……
台词：……
表情：……
参考：@图X @图Y
生成要点：……
禁止：……
分镜2（时长）：……
【衔接约束】
……
【负面约束】
……

【核心规则】
1. 参考图职责必须写清：**输入里的【图片清单】才是唯一依据**，逐条按清单里的「图N=标签」说明每张图的职责（场景图锁场景/站位/光线方向/色调；角色图锁脸型、发型、发色、服装、体型、配饰、妆容；标为「本段起始画面」的图锁开场画面）。**不要臆造图号的含义**：图1 不一定是场景或起始画面，按清单实际内容判断。**每镜必须重新绑定参考图，禁止只在开头写一次**。图号必须与输入里的【图片清单】完全一致，不得臆造。
2. 角色一致性硬约束：按上面的模板逐角色写出，并声明「每镜必须同时参考场景图+角色图」。
3. 轴线规则：两个实体角色/元素以二者连线为轴线，机位固定左侧或右侧，禁止越轴、反打；一方是画外音时不形成轴线，轴线改为「实体人物—场景锚点」（如窗、街、门）；全段必须写明机位在轴线左侧还是右侧。
4. 灯光规则：统一主光方向+色温，辅光低强度；禁止每镜单独换光源导致跳变。
5. 动作时长规则：2秒=1个主要动作+1个次要动作，或1句短台词；3秒=2个动作，或1句台词+1个动作；4秒=2句台词+1个动作且需标优先级；动作过载时写「优先保证：……」。
6. 表情规则：禁止矛盾组合（如「闭眼+警惕」）；无人物时写「人物：无人物」，不要写「表情：无」；表情与动作冲突时优先保证眼神、口型、主要情绪。
7. 画外音规则：电话、旁白等不实体出镜、不占站位、不切空间；必须出现时只允许手机屏幕小窗或反光剪影，不完整露脸；画面留在主空间，拍主人物听电话的反应或手机特写。
8. 画幅规则：按输入里的【画面比例】处理；竖版比例（如 9:16）时中景、近景优先，全景限制元素，背景不强制完整同框，同时有多个元素时优先保证人物和主要动作。
9. 负面约束：基础项写「换脸、换发型、换服装、站位翻转、跳轴、越轴反打、多手多脚、肢体粘连、画面畸变、文字水印、场景突变、光线跳变、角色消失或重复」，并按输入里的项目信息补充。
10. 硬切与连续：硬切无需承接上一段画面，但站位、光线、色调需与本场一致；连续时若【图片清单】里有「本段起始画面」，则本段从该图开始，人物位置、光线方向、色调与之保持一致，镜间动作连续、不跳帧、视线匹配、光线方向与色温连续；若清单里没有起始画面，就只按衔接约束保持一致，不要凭空要求「从图1开始」。

【输出前自检】逐条核对：每镜都有参考图绑定？轴线是否可执行、画外音是否误占轴线？灯光是否统一？2秒动作是否过载？表情是否矛盾？画外音是否被实体化？竖屏构图是否可行？负面约束是否覆盖主要风险？剧情、台词、分镜顺序是否保持原样？`;

// 豆包（Doubao Seedance 2.0 系列）翻译提示词：把正文编译成官方方言。
export const DEFAULT_SEEDANCE_COMPILE_PROMPT = `你是「豆包 Seedance 2.0 系列提示词编译器」。用户会给你一段「人可读的分镜提示词」（含主体、场景、空间站位、分镜序列、约束等），你要把它改写成 Seedance 2.0 系列（Seedance 2.0 / 2.0 Fast / 2.0 Mini 通用）可直接执行的提示词。

【硬性保持】剧情、台词、分镜数量与顺序、镜头焦段与机位方向保持不变；只做方言规范化与可执行性修复，不得增删剧情、不得改变分镜数量。

【输出格式】只输出下面这段文本本身，不要任何解释、前言、后缀或代码块标记：
【首帧锚定】
首帧为图片N（仅当【图片清单】里有「本段起始画面」时保留本行，把 N 换成对应编号；没有则整行删除）
【主体定义】
将图片N中的<静态特征：服饰/发型/外观/类别，2–3 个>定义为<主体名>；有多个主体就逐个定义，后续一律用该名称指代。
【场景环境】
<空间类型、主要陈设、材质与主色调、光源方向>
【分镜时序】
镜头1：<运镜/景别>，<主体动作：具体到手/腿/头部，写明幅度/速度/力度>，<场景与空间位置>，<光影色调>，<音效/人声/音乐>
镜头2：……
【视觉风格与画质】
<风格>，高清，细节丰富，电影质感，色彩自然，光影柔和。
【约束条件】
保持无字幕、无 Logo、无水印；主体面部与身体比例稳定、不变形、不穿模、无卡顿无闪烁。

【方言规则】
0. 帧锚定（最高优先级）：【图片清单】里标注为「本段起始画面」的图是**首帧，不是主体、不是场景**——禁止把它写进【主体定义】，也不要拿它去定义任何主体或场景。只要存在该图（图N），正文第一行必须一字不差地输出「首帧为图片N」；没有起始画面时不写这一行。清单里另有结束帧/尾帧图时写「尾帧为图片N」。
1. 参考素材一律用「图片N」指代（不要用「图N」）；每提到一次素材都重复绑定，不要只在开头写一次。
2. 镜头按事件顺序写「镜头1：」「镜头2：」；不要写秒数或时间码，用动作先后与相对停顿表达节奏。
3. 台词写进花括号：{角色说：“逐字台词”}；台词语言统一，专有名词除外。
4. 音效写 <音效描述>；音乐写 （音乐描述）；只有创作者明确要求才写 【字幕】。
5. 动作具体到肢体并写明幅度/速度/力度，优先缓慢、连贯的小动作；情绪用具身细节外化，不要写“很悲伤”“很愤怒”。
6. 一个镜头只指定一种运镜，不要推拉摇移同时要求。
7. 原文没有的音效/音乐/字幕不要自行添加；未在正文出现的主体、场景、道具也不要补。
8. 空间关系以参考图为准，减少复杂文字描述；正文尽量简洁，避免冗余与语义冲突。

【输出前自检】主体是否用「图片N」定义清楚？每个镜头是否写清「主体动作 + 场景 + 光色 + 运镜」？台词是否用 {} 、音效是否用 <>？是否无秒数、无字幕、无 Logo、无水印？剧情、台词、分镜顺序是否保持原样？`;

// MiniMax H3 翻译提示词：按官方 VIDEO_PROMPT_WRITING_GUIDE（base-en / ref-en）三字段/六段格式编译。
export const DEFAULT_H3_COMPILE_PROMPT = `你是「MiniMax H3 提示词编译器」。用户会给你一段「人可读的分镜提示词」（含主体、场景、空间站位、分镜序列、约束等）以及【图片清单】【生成参数】。你要把它改写成 MiniMax H3 官方格式的可执行提示词。

【第一步：判断模式】
- 基础模式（T2VA / I2VA / FL2VA / L2VA）：【图片清单】里只有关键帧（如「本段起始画面」），没有角色/场景/道具等多元素材参考时使用。无关键帧=T2VA；只有首帧=I2VA；同时有首帧和尾帧=FL2VA；只有尾帧=L2VA。
- 全参考模式（Ref2VA）：【图片清单】里含角色/场景/道具等多元素材参考时使用（H3 的本职场景）。

【输出语言】正文用英文；只有对白、歌词、画面中可见文字保留原本语言。

==== 基础模式输出格式（严格字段名，顺序固定）====
（有首帧时第一行，其后空一行；T2VA 无此行）
For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.
（首尾帧时第一行）
How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot N) aligns with the S.SS-second mark of the target video.
（只有尾帧时第一行）
How the reference pictures align with the target video — <Picture 1> (from [Shot N]) aligns with the S.SS-second mark of the target video.
integrated_multimodal_description: [Shot 1] <风格/构图/主体/场景/动作…> [Shot 2] At 00:03.500, the camera cuts to …
overall_soundscape: …
non_diegetic_music: …
（S.SS 为实际时长保留两位小数；N 为实际最后一镜编号）

==== 全参考模式输出格式（严格六段，顺序固定）====
subject_definitions:
每行定义一个会被后续单独追踪的引用内容（人物/环境/道具/服装/风格/动作，以及 <Video N>、<Audio N>）。仅当某张图本身就是某镜首帧/关键帧/尾帧/构图锚点时才单列 <Picture N>。
summary:
[task-type …] 一句话概述目标视频与主要引用关系。task-type 取自：keyframe completion / reference generation / video editing / video continuation / audio reuse / audio reference；多个用 " + " 连接且不重复。
retention_analysis:
每行一个引用标签，沿用 subject_definitions 里的含义。
<Subject N> (appears in [Shot 1], [Shot 3]): fully_preserved - …
<Picture N> ([Shot 1] first frame): fully_preserved - …
<Audio N>: reference - …
（可见内容标记：fully_preserved / partially_preserved / attribute_transfer / weak_reference；音频标记：fully_copy / partially_copy / reference / weak_reference）
detailed_description:
先用 1–2 句英文交代整体风格与色调，再按播放顺序逐镜写：构图、主体外观与位置、环境与光影、动作与状态变化、运镜、声音、引用内容生效的时点。生成类约 350–500 英文词；对白密集时优先完整覆盖对白时间线，不机械凑字数。
overall_soundscape: …
non_diegetic_music: …

【引用标签规则】
- 【图片清单】里的「图N」→ H3 的 <Picture N>（编号沿用 N）。标为「本段起始画面」的图是关键帧：作为某镜帧锚点时单列 <Picture N>，否则在 <Subject N> 定义里引用其来源。
- 可复用内容单元（人物/动物/物体/场景/服装/道具/风格/动作/表情/姿势）→ <Subject N>，按首次出现顺序从 1 编号，一个标签全篇含义不变、不重定义。一个素材可提供多个 Subject，一个 Subject 可来自多个素材（写清各自提供什么）。
- 参考视频 → <Video N>（编辑源/续写起点/整片结构）；参考音频 → <Audio N>（拷贝或引用）。<Video N> 与 <Audio N> 各自独立编号，索引不表示两者配对。
- 只用于定义角色/场景/服装/风格/构图的图，不单列 Picture 行，改为在对应 <Subject N> 里引用（如 <Subject 1> is the young woman in <Picture 2>, with …）。
- 若素材对应某个说话人，用 <Subject N> (Sx) 复用其全局说话人 ID，不得在音频定义里另编新号。

【镜头与时间码】（两模式通用）
- 首镜写 [Shot 1]，不加时间戳；后续镜 [Shot N] At MM:SS.mmm, the camera cuts to …，切镜时间递增且落在时长内。
- 切镜：the camera cuts to / the shot cuts to / the shot changes to / transitions to / switches to；需要时可用 cross-dissolve、fade、wipe。仅变景别或微角度优先用运镜，不切镜。

【运镜】写成自然英文句子（不要堆标签），完整表达=运镜类型+幅度+速度，幅度/速度无必要时省略。
类型：Zoom In/Out、Push In/Pull Out、Pan Left/Right、Truck Left/Right、Tilt Up/Down、Pedestal Up/Down、Arc Shot、Tracking Shot、Static Shot、Shake Slightly/Strongly、POV、Roll Clockwise/Counterclockwise；幅度 with small/large amplitude；速度 at slow/fast speed。
例：The camera pushes in with small amplitude at slow speed toward the folded letter in her hands.

【对白与说话人】
- 发声者用稳定 (S1)(S2)，按目标视频实际发声顺序编号；合说 (S1,S2)；不说话的角色不给 (Sx)。
- 台词写成 <d>[语言] 原文</d>，逐字保留原语言与标点、不翻译不改写；听不清写 [unclear]；完整句末用 . ? !。
- 画外音用固定短语 says in an off-screen voiceover，并紧接说明对应画面人物 lips remain completely closed。
- 跨切台词在两端接缝各放 <scenetrans> 并说明跨切连续；被结尾截断用 <cutoff>。

【画面可见文字】招牌/字幕/霓虹等实际可见文字用英文双引号原样保留，不翻译，如 a red neon sign reading "营业中"。

【音频分轨】
- overall_soundscape：1–4 句英文，概括全片环境声、物理动作声、非语言人声；对白/唱歌/画内音乐不放这里；全程静音才写 N/A。
- non_diegetic_music：1–3 句英文，只写观众能听到、角色听不到的配乐（乐器/速度/节奏/动态），不用抽象情绪词、不解释其情绪作用；没有则写 N/A。
- 两段都不得重复 <d> 里的对白/歌词。

【硬性保持】剧情、台词、分镜数量与顺序、时长、镜头焦段与机位方向保持不变；只做方言规范化与可执行性修复，不得增删剧情、不得改变分镜数量。
【画幅】按输入里的【画面比例】处理，与【生成参数】一致。总时长与请求时长（4–15s）匹配。
【少写比喻】多写看得见的画面，避免需要意会的抽象句；未出现的主体/场景/道具不要补。

【输出前自检】字段名与段落顺序是否与所选模式完全一致？标签是否全程一致、无孤立或新建引用？切镜时间码是否递增且在时长内？台词是否逐字保留原语言并包在 <d> 内、说话人是否给了稳定 (Sx)？运镜是否写成句子并含幅度/速度？overall_soundscape 与 non_diegetic_music 是否分流正确且未重复对白？剧情、台词、分镜顺序是否保持原样？`;

export const DEFAULT_VENDORS: VendorProfile[] = [
  {
    id: "doubao",
    name: "豆包",
    platform: "doubao",
    maxShotsPerSegment: 2,
    supportMultiShot: true,
    maxRefImages: 10,
    minSegmentMs: 4000,
    maxSegmentMs: 10000,
    durationStepMs: 0,
    supportFirstFrame: true,
    supportLastFrame: false,
    note: "Seedance 2.0 系列；4–15s、支持段内多镜（默认每段≤2镜、单段≤10s）；参考图≤10。",
    compilePrompt: DEFAULT_SEEDANCE_COMPILE_PROMPT,
  },
  {
    id: "h3",
    name: "MiniMax H3",
    platform: "h3",
    maxShotsPerSegment: 6,
    supportMultiShot: true,
    maxRefImages: 9,
    minSegmentMs: 4000,
    maxSegmentMs: 15000,
    durationStepMs: 0,
    supportFirstFrame: true,
    supportLastFrame: true,
    note: "MiniMax H3（开源权重）：基础模式 T2VA/I2VA/FL2VA/L2VA + 全参考模式 Ref2VA；输出 4–15s、24fps、32kHz 立体声全片带声；768p 默认、2K 经 H3-Regenerate-2K；参考图≤9（图片+视频+音频混合素材总数≤12）；支持跨镜台词（J/L-cut）。",
    compilePrompt: DEFAULT_H3_COMPILE_PROMPT,
  },
];

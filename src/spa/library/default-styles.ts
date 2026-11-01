import type { LibraryStyle } from "@core/shared/library/types";

function csv(...parts: string[]): string {
  return parts.filter(Boolean).join("，");
}

const URBAN_BASE =
  "现代都市风格，当代中国城市，都市剧质感，电影级渲染，高细节，8K，真实光影，现代建筑，城市街景";
const URBAN_2D_BASE =
  "国漫现代都市风，2D动画，干净线稿，赛璐璐上色，时尚角色设计，都市漫画感，鲜艳但不荧光，电影感构图";
const URBAN_3D_BASE =
  "国漫3D都市动画风格，次世代CG，半写实比例，现代都市，真实材质，城市霓虹，玻璃幕墙反射，电影级光影";
const URBAN_PEOPLE =
  "都市青年，现代发型，干净妆容，通勤西装，衬衫，风衣，针织衫，连衣裙，高跟鞋，休闲夹克，时尚穿搭，职场精英，都市白领，豪门千金，悬疑便装";
const URBAN_SCENES =
  "现代城市街道，CBD高楼，玻璃幕墙写字楼，办公室，会议室，咖啡厅，商场，地铁站，公寓客厅，卧室，天台，雨夜巷子，地下停车场，校园操场，便利店";
const URBAN_LIGHT =
  "自然光，窗光，逆光，霓虹灯，路灯暖光，雨夜反射，玻璃反射，体积光，丁达尔光，冷蓝夜景，暖橙室内，高对比，电影氛围";
const URBAN_CAMERA =
  "电影级构图，中景，近景，特写，低角度仰拍，广角街景，浅景深，背景虚化，跟随镜头感，动态模糊，对称构图";
const URBAN_DETAIL =
  "细雨，雨滴，湿地反光，夜景霓虹，车流灯轨，玻璃倒影，城市雾气，风吹发丝，衣角飘动，真实皮肤质感";

const PALACE_BASE =
  "3D国漫古风，宫廷古偶风，次世代CG动画，半写实比例，电影级渲染，UE5质感，高细节，8K，古装言情剧感";
const PALACE_PEOPLE =
  "古装俊美男女，半写实五官，广袖长袍，襦裙，披风，华服刺绣，云纹暗纹，金线滚边，发冠，步摇，簪花，玉佩，腰封，古风妆容，发丝清晰";
const PALACE_SCENES =
  "朱红宫墙，长廊，汉白玉台阶，大殿，朝堂，御花园，寝殿，纱幔，屏风，烛台，雕花窗棂，宫灯，庭院石桥";
const PALACE_MATERIAL =
  "丝绸质感，锦缎反光，刺绣立体感，玉佩温润，金属发冠高光，纱幔半透明，木雕纹理，石阶磨损细节";
const PALACE_LIGHT =
  "烛光暖光，窗棂光影，纱幔透光，月光，逆光轮廓，体积光，柔光，低对比古风色调，宫廷唯美氛围";
const PALACE_CAMERA =
  "电影级构图，对称构图，中景，近景，特写，低角度仰拍，浅景深，背景虚化，古偶剧照感";

export const DEFAULT_STYLES: LibraryStyle[] = [
  {
    id: "style_cn_xianxia",
    name: "国漫玄幻",
    prompt:
      "国漫玄幻风格，东方仙侠，次世代CG动画，半写实比例，国漫3D动画风，电影级渲染，高细节，8K，虚幻引擎质感，电影级构图，景深，动态模糊，史诗感，玄黑赤金，月白青碧，紫电银蓝，赤焰金红，体积光，边缘光，逆光，丁达尔光，氛围光，高对比，灵气粒子环绕，符文法阵，剑罡，雷霆紫电，冰晶寒霜，妖兽虚影，灵气漩涡，法术光效",
    videoStyle:
      "国漫玄幻CG动画质感，东方仙侠，半写实比例，电影级渲染，高细节，8K，虚幻引擎质感，电影级构图，景深，动态模糊，史诗感，玄黑赤金、月白青碧、紫电银蓝、赤焰金红色调，体积光、边缘光、逆光、丁达尔光、氛围光，高对比",
    builtin: true,
  },
  {
    id: "style_modern_urban",
    name: "现代都市",
    prompt: csv(
      URBAN_BASE,
      URBAN_PEOPLE,
      URBAN_SCENES,
      URBAN_LIGHT,
      URBAN_CAMERA,
      URBAN_DETAIL,
    ),
    videoStyle: csv(URBAN_BASE, URBAN_LIGHT, URBAN_CAMERA, URBAN_DETAIL),
    builtin: true,
  },
  {
    id: "style_modern_urban_2d",
    name: "2D 国漫都市",
    prompt: csv(
      URBAN_2D_BASE,
      URBAN_PEOPLE,
      URBAN_SCENES,
      URBAN_LIGHT,
      URBAN_CAMERA,
      URBAN_DETAIL,
    ),
    videoStyle: csv(URBAN_2D_BASE, URBAN_LIGHT, URBAN_CAMERA, URBAN_DETAIL),
    builtin: true,
  },
  {
    id: "style_modern_urban_3d",
    name: "3D 国漫都市",
    prompt: csv(
      URBAN_3D_BASE,
      URBAN_PEOPLE,
      URBAN_SCENES,
      URBAN_LIGHT,
      URBAN_CAMERA,
      URBAN_DETAIL,
    ),
    videoStyle: csv(URBAN_3D_BASE, URBAN_LIGHT, URBAN_CAMERA, URBAN_DETAIL),
    builtin: true,
  },
  {
    id: "style_3d_palace",
    name: "3D 宫廷古偶风",
    prompt: csv(
      PALACE_BASE,
      PALACE_PEOPLE,
      PALACE_SCENES,
      PALACE_MATERIAL,
      PALACE_LIGHT,
      PALACE_CAMERA,
    ),
    videoStyle: csv(PALACE_BASE, PALACE_LIGHT, PALACE_CAMERA),
    builtin: true,
  },
  {
    id: "style_anime_cel",
    name: "日系赛璐璐漫剧",
    prompt:
      "日系赛璐璐漫剧风格，细腻描线，干净色块，电影级布光，人物比例写实偏美化",
    videoStyle:
      "日系赛璐璐动画质感，清晰线稿，干净色块，人物比例稳定，电影级布光，流畅运镜",
    builtin: true,
  },
  {
    id: "style_cn_realistic",
    name: "写实国漫",
    prompt:
      "写实国漫风格，半写实人体，精致五官，柔和厚涂阴影，电影级构图与布光",
    videoStyle:
      "半写实国漫质感，精致五官，柔和阴影，电影级构图与布光，人物比例稳定",
    builtin: true,
  },
  {
    id: "style_painterly",
    name: "厚涂电影感",
    prompt:
      "厚涂插画风格，丰富笔触与体积光，高对比电影级布光，氛围感强",
    videoStyle:
      "厚涂质感，丰富笔触，体积光，高对比电影级布光，氛围感强，轻微胶片颗粒",
    builtin: true,
  },
  {
    id: "style_ink",
    name: "国风水墨",
    prompt:
      "中国水墨画风格，留白意境，墨色浓淡晕染，淡雅配色，古典东方美学",
    videoStyle:
      "中国水墨质感，留白构图，墨色浓淡晕染，淡雅配色，柔和光线，画面稳定",
    builtin: true,
  },
  {
    id: "style_3d_cartoon",
    name: "3D 卡通",
    prompt:
      "3D 卡通渲染风格，皮克斯质感，圆润造型，柔和全局光照，材质细腻",
    videoStyle:
      "3D 卡通渲染，皮克斯质感，圆润造型，柔和全局光照，材质细腻，动作流畅",
    builtin: true,
  },
  {
    id: "style_comic_ink",
    name: "热血漫画",
    prompt:
      "日式热血漫画风格，强对比黑白线稿上色，速度线与集中线，夸张透视",
    videoStyle:
      "日式热血漫画质感，强对比线稿上色，夸张透视，速度线，动感镜头，动作流畅",
    builtin: true,
  },
];

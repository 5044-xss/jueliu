import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { NextResponse } from "next/server";
import { z } from "zod";
import { projectExists } from "@core/server/projects";
import { renderSegment } from "@core/server/render";

export const runtime = "nodejs";

const bodySchema = z.object({
  projectId: z.string(),
  segmentId: z.string(),
  platform: z.string().default("doubao"),
  keyframeOnly: z.boolean().optional(),
});

function safeName(name: string, ext: string): string {
  const base =
    name
      .replace(/[\\/:*?"<>|\r\n\t]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60) || "参考图";
  return `${base}${ext}`;
}

function cscPath(): string {
  const root = process.env.WINDIR || "C:\\Windows";
  return path.join(
    root,
    "Microsoft.NET",
    "Framework64",
    "v4.0.30319",
    "csc.exe",
  );
}

function resolveHelper(): string {
  const candidates = [
    process.env.CLIPBOARD_HELPER,
    path.join(process.cwd(), "resources", "clipboard-files.exe"),
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  const source = path.join(process.cwd(), "resources", "clipboard-files.cs");
  const csc = cscPath();
  if (!fs.existsSync(source) || !fs.existsSync(csc)) {
    throw new Error("剪贴板助手不可用");
  }
  const target = path.join(os.tmpdir(), "jueliu-clipboard-files.exe");
  const result = spawnSync(
    csc,
    [
      "/nologo",
      "/target:exe",
      `/out:${target}`,
      source,
      "/r:System.Windows.Forms.dll",
    ],
    { windowsHide: true },
  );
  if (result.status !== 0 || !fs.existsSync(target)) {
    throw new Error("剪贴板助手编译失败");
  }
  return target;
}

function setFileList(helper: string, files: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const listFile = path.join(path.dirname(files[0]), "files.txt");
    fs.writeFileSync(listFile, files.join("\r\n"), "utf8");
    const child = spawn(helper, [listFile], { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr.trim() || "写入剪贴板失败"));
      }
    });
  });
}

export async function POST(request: Request) {
  if (process.platform !== "win32") {
    return NextResponse.json(
      { error: "当前系统暂不支持复制多张图片" },
      { status: 501 },
    );
  }
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }
  const { projectId, segmentId, platform, keyframeOnly } = parsed.data;
  if (!projectExists(projectId)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const rendered = renderSegment(projectId, segmentId, platform, {
    keyframeOnly,
  });
  if (!rendered) {
    return NextResponse.json({ error: "段落不存在" }, { status: 404 });
  }
  const items = rendered.manifest.filter(
    (item) =>
      item.imagePath &&
      fs.existsSync(/* turbopackIgnore: true */ item.imagePath),
  );
  if (items.length === 0) {
    return NextResponse.json({ error: "没有可复制的参考图" }, { status: 400 });
  }

  const tempDir = path.join(os.tmpdir(), "jueliu-ref-copy");
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.mkdirSync(tempDir, { recursive: true });
    const files: string[] = [];
    for (const item of items) {
      const source = item.imagePath as string;
      const ext = path.extname(source).toLowerCase() || ".png";
      const target = path.join(
        tempDir,
        safeName(`${item.slot}_${item.label}`, ext),
      );
      fs.copyFileSync(/* turbopackIgnore: true */ source, target);
      files.push(target);
    }
    const helper = resolveHelper();
    await setFileList(helper, files);
    return NextResponse.json({
      ok: true,
      count: files.length,
      total: rendered.manifest.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "复制失败" },
      { status: 500 },
    );
  }
}

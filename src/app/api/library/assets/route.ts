import fs from "node:fs";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  addLibraryAsset,
  listLibraryAssets,
  resolveViewSource,
  type AssetLibraryScope,
} from "@core/server/library/assets";
import { projectExists } from "@core/server/projects";

const addSchema = z.object({
  scope: z.enum(["global", "project"]),
  seriesId: z.string().optional(),
  projectId: z.string().min(1),
  viewId: z.string().min(1),
});

function parseScope(
  url: URL,
): { scope: AssetLibraryScope; seriesId: string | null } | { error: string } {
  const raw = url.searchParams.get("scope") ?? "global";
  const seriesId = url.searchParams.get("seriesId");
  if (raw !== "global" && raw !== "project") {
    return { error: "参数不合法" };
  }
  if (raw === "project" && !seriesId) {
    return { error: "缺少项目标识" };
  }
  return {
    scope: raw as AssetLibraryScope,
    seriesId: raw === "global" ? null : seriesId,
  };
}

export async function GET(request: Request) {
  const parsed = parseScope(new URL(request.url));
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  return NextResponse.json({
    assets: listLibraryAssets(parsed.scope, parsed.seriesId),
  });
}

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsedBody = addSchema.safeParse(json);
  if (!parsedBody.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }
  const { scope, seriesId, projectId, viewId } = parsedBody.data;
  if (scope === "project" && !seriesId) {
    return NextResponse.json({ error: "缺少项目标识" }, { status: 400 });
  }
  if (!projectExists(projectId)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const source = resolveViewSource(projectId, viewId);
  if (!source) {
    return NextResponse.json({ error: "视角不存在" }, { status: 404 });
  }
  if (!source.imagePath || !fs.existsSync(source.imagePath)) {
    return NextResponse.json({ error: "该视角尚未回传图片" }, { status: 400 });
  }
  const targetSeriesId = scope === "global" ? null : seriesId ?? null;
  const existing = listLibraryAssets(scope, targetSeriesId).find(
    (item) =>
      item.sourceViewId === viewId ||
      (!item.sourceViewId &&
        item.type === source.type &&
        item.name === source.name &&
        item.variantLabel === source.variantLabel &&
        item.prompt === source.prompt),
  );
  if (existing) {
    return NextResponse.json(
      { error: "该资产已在资产库中，无需重复添加", item: existing },
      { status: 409 },
    );
  }
  const item = addLibraryAsset({
    scope,
    seriesId: targetSeriesId,
    type: source.type,
    name: source.name,
    variantLabel: source.variantLabel,
    prompt: source.prompt,
    sourceImagePath: source.imagePath,
    sourceViewId: viewId,
  });
  return NextResponse.json({ item }, { status: 201 });
}

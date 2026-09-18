import { getProjectDb, newId, nowIso } from "@/lib/db";
import type { Script, Scene, Beat } from "@/lib/schemas/script";

interface ScriptRow {
  id: string;
  project_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface SceneRow {
  id: string;
  script_id: string;
  idx: string;
  slug: string;
  location: string;
  time_of_day: string;
  interior_exterior: string;
  summary: string;
  characters_json: string;
  beats_json: string;
  sort_order: number;
}

export interface StoredScene extends Scene {
  id: string;
}

export interface StoredScript {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  scenes: StoredScene[];
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function getStoredScript(projectId: string): StoredScript | null {
  const db = getProjectDb(projectId);
  const script = db
    .prepare("SELECT * FROM script WHERE project_id = ? LIMIT 1")
    .get(projectId) as ScriptRow | undefined;
  if (!script) return null;
  const scenes = db
    .prepare("SELECT * FROM scene WHERE script_id = ? ORDER BY sort_order ASC")
    .all(script.id) as SceneRow[];
  return {
    id: script.id,
    title: script.title,
    createdAt: script.created_at,
    updatedAt: script.updated_at,
    scenes: scenes.map((row) => ({
      id: row.id,
      index: row.idx,
      slug: row.slug,
      location: row.location,
      timeOfDay: row.time_of_day,
      interiorExterior: row.interior_exterior as Scene["interiorExterior"],
      summary: row.summary,
      characters: parseJson<string[]>(row.characters_json, []),
      beats: parseJson<Beat[]>(row.beats_json, []),
    })),
  };
}

export function saveScript(projectId: string, script: Script): StoredScript {
  const db = getProjectDb(projectId);
  const now = nowIso();
  const scriptId = newId();

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM script WHERE project_id = ?").run(projectId);
    db.prepare(
      `INSERT INTO script (id, project_id, title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(scriptId, projectId, script.title, now, now);

    const insertScene = db.prepare(
      `INSERT INTO scene
       (id, script_id, idx, slug, location, time_of_day, interior_exterior, summary, characters_json, beats_json, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    script.scenes.forEach((scene, i) => {
      insertScene.run(
        newId(),
        scriptId,
        scene.index,
        scene.slug,
        scene.location,
        scene.timeOfDay,
        scene.interiorExterior,
        scene.summary,
        JSON.stringify(scene.characters),
        JSON.stringify(scene.beats),
        i,
      );
    });
  });
  tx();

  return getStoredScript(projectId)!;
}

export function updateScene(
  projectId: string,
  sceneId: string,
  patch: Partial<Scene>,
): void {
  const db = getProjectDb(projectId);
  const current = db.prepare("SELECT * FROM scene WHERE id = ?").get(sceneId) as
    | SceneRow
    | undefined;
  if (!current) throw new Error("场次不存在");
  db.prepare(
    `UPDATE scene SET idx = ?, slug = ?, location = ?, time_of_day = ?,
     interior_exterior = ?, summary = ?, characters_json = ?, beats_json = ? WHERE id = ?`,
  ).run(
    patch.index ?? current.idx,
    patch.slug ?? current.slug,
    patch.location ?? current.location,
    patch.timeOfDay ?? current.time_of_day,
    patch.interiorExterior ?? current.interior_exterior,
    patch.summary ?? current.summary,
    JSON.stringify(patch.characters ?? parseJson(current.characters_json, [])),
    JSON.stringify(patch.beats ?? parseJson(current.beats_json, [])),
    sceneId,
  );
  db.prepare("UPDATE script SET updated_at = ? WHERE id = ?").run(
    nowIso(),
    current.script_id,
  );
}

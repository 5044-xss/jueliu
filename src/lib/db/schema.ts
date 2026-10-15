export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  style TEXT NOT NULL DEFAULT '',
  style_id TEXT,
  aspect_ratio TEXT NOT NULL DEFAULT '9:16',
  default_segment_ms INTEGER NOT NULL DEFAULT 10000,
  vendor TEXT NOT NULL DEFAULT 'doubao',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS story (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS script (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scene (
  id TEXT PRIMARY KEY,
  script_id TEXT NOT NULL REFERENCES script(id) ON DELETE CASCADE,
  idx TEXT NOT NULL,
  slug TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  time_of_day TEXT NOT NULL DEFAULT '',
  interior_exterior TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  characters_json TEXT NOT NULL DEFAULT '[]',
  beats_json TEXT NOT NULL DEFAULT '[]',
  blocking_json TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS asset (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  base_prompt TEXT NOT NULL DEFAULT '',
  original_name TEXT,
  original_base_prompt TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS variant (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  prompt TEXT NOT NULL DEFAULT '',
  original_label TEXT,
  original_prompt TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS view (
  id TEXT PRIMARY KEY,
  variant_id TEXT NOT NULL REFERENCES variant(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  prompt TEXT NOT NULL DEFAULT '',
  original_label TEXT,
  original_prompt TEXT,
  image_path TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS segment (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  scene_id TEXT NOT NULL REFERENCES scene(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  generation_mode TEXT NOT NULL DEFAULT 'multi-shot',
  target_ms INTEGER NOT NULL DEFAULT 10000,
  first_frame_id TEXT,
  hard_cut INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  video_path TEXT,
  ai_prompt TEXT,
  ai_prompt_sig TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shot (
  id TEXT PRIMARY KEY,
  segment_id TEXT NOT NULL REFERENCES segment(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  ideal_ms INTEGER,
  continues_prev INTEGER NOT NULL DEFAULT 0,
  camera_json TEXT NOT NULL DEFAULT '{}',
  lighting TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL DEFAULT '',
  dialogue TEXT NOT NULL DEFAULT '',
  dialogue_json TEXT NOT NULL DEFAULT '[]',
  expression TEXT NOT NULL DEFAULT '',
  subject_node_ids_json TEXT NOT NULL DEFAULT '[]',
  original_json TEXT
);

CREATE TABLE IF NOT EXISTS shot_ref (
  id TEXT PRIMARY KEY,
  shot_id TEXT NOT NULL REFERENCES shot(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  asset_id TEXT,
  variant_id TEXT,
  view_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS frame (
  id TEXT PRIMARY KEY,
  segment_id TEXT NOT NULL REFERENCES segment(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  image_path TEXT NOT NULL,
  confirmed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS video_asset (
  id TEXT PRIMARY KEY,
  segment_id TEXT NOT NULL REFERENCES segment(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompt_template (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '1',
  body_template TEXT NOT NULL DEFAULT '',
  params_template TEXT NOT NULL DEFAULT '',
  legend_template TEXT NOT NULL DEFAULT '',
  variables_json TEXT NOT NULL DEFAULT '[]',
  editable INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skill (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL DEFAULT '1',
  enabled INTEGER NOT NULL DEFAULT 1,
  config_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS continuity_rule_set (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  rules_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS composition (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  segment_ids_json TEXT NOT NULL DEFAULT '[]',
  export_path TEXT,
  transition TEXT NOT NULL DEFAULT 'fade',
  transition_ms INTEGER NOT NULL DEFAULT 500,
  status TEXT NOT NULL DEFAULT 'ready',
  error TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stale_mark (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  source_stage TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  message TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_scene_script ON scene(script_id);
CREATE INDEX IF NOT EXISTS idx_segment_scene ON segment(scene_id);
CREATE INDEX IF NOT EXISTS idx_segment_project ON segment(project_id);
CREATE INDEX IF NOT EXISTS idx_shot_segment ON shot(segment_id);
CREATE INDEX IF NOT EXISTS idx_shot_ref_shot ON shot_ref(shot_id);
CREATE INDEX IF NOT EXISTS idx_shot_ref_asset ON shot_ref(asset_id);
CREATE INDEX IF NOT EXISTS idx_shot_ref_variant ON shot_ref(variant_id);
CREATE INDEX IF NOT EXISTS idx_shot_ref_view ON shot_ref(view_id);
CREATE INDEX IF NOT EXISTS idx_variant_asset ON variant(asset_id);
CREATE INDEX IF NOT EXISTS idx_view_variant ON view(variant_id);
CREATE INDEX IF NOT EXISTS idx_asset_project ON asset(project_id);
CREATE INDEX IF NOT EXISTS idx_frame_segment ON frame(segment_id);
CREATE INDEX IF NOT EXISTS idx_video_asset_segment ON video_asset(segment_id);
CREATE INDEX IF NOT EXISTS idx_composition_project ON composition(project_id);
CREATE INDEX IF NOT EXISTS idx_story_project ON story(project_id);
CREATE INDEX IF NOT EXISTS idx_job_project ON job(project_id);
CREATE INDEX IF NOT EXISTS idx_job_project_status ON job(project_id, status);
`;

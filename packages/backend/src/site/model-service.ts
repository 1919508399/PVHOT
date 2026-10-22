// Settings the operator can change in the admin without a release: the model service (address, key,
// model name) and the changelog entries published from the admin. Stored in the settings table as JSON
// and pulled into every backend process by a short poll, so a save in the admin reaches the worker too.
import type { AdminChangelogEntry, AdminModelService, AnalysisMode } from "@aihot/contracts/admin";
import { sql } from "../db.ts";
import { audit } from "../audit.ts";
import {
  getAdminReleases, getAnalysisMode, setAdminReleases, setAnalysisMode, setModelOverride, type ModelServiceOverride,
} from "../runtime-overrides.ts";
import { applyCollectorKeys } from "./channel-keys.ts";

const MODEL_KEY = "model_service";
const CHANGELOG_KEY = "changelog_admin";
const MODE_KEY = "analysis_mode";

const DEFAULT_BASE_URL = "https://api.deepseek.com/v1";
const DEFAULT_MODEL = "deepseek-chat";
const KINDS: ReadonlyArray<AdminChangelogEntry["kind"]> = ["更新", "优化", "公告", "下线"];
const MODES: ReadonlyArray<AnalysisMode> = ["model", "rules"];

async function readSetting<T>(key: string): Promise<T | null> {
  const rows = await sql<{ value: T }[]>`SELECT value FROM settings WHERE key = ${key}`;
  return rows[0]?.value ?? null;
}

/** Loads every override into this process; safe to call before the schema exists (setup). */
export async function refreshRuntimeSettings(): Promise<void> {
  try {
    const [model, changelog, mode] = await Promise.all([
      readSetting<ModelServiceOverride>(MODEL_KEY),
      readSetting<{ releases?: AdminChangelogEntry[] }>(CHANGELOG_KEY),
      readSetting<{ mode?: string }>(MODE_KEY),
    ]);
    const usable = model && (model.apiKey?.trim() || model.baseUrl?.trim() || model.model?.trim()) ? {
      baseUrl: (model.baseUrl ?? "").trim(),
      model: (model.model ?? "").trim(),
      apiKey: (model.apiKey ?? "").trim(),
    } : null;
    setModelOverride(usable);
    setAnalysisMode(MODES.includes(mode?.mode as AnalysisMode) ? (mode!.mode as AnalysisMode) : "model");
    setAdminReleases(Array.isArray(changelog?.releases) ? changelog!.releases! : []);
    await applyCollectorKeys();
  } catch {
    // The settings table is missing while setup runs; the next poll picks it up.
  }
}

/** Starts the poll; every process that calls models or serves the changelog runs one. */
export function startRuntimeRefresh(intervalMs = 15_000): void {
  void refreshRuntimeSettings();
  const timer = setInterval(() => void refreshRuntimeSettings(), intervalMs);
  timer.unref();
}

function keyHint(key: string): string {
  return key.length >= 12 ? `${key.slice(0, 4)}…${key.slice(-4)}` : "已设置";
}

export async function modelServiceView(): Promise<AdminModelService> {
  const stored = await readSetting<ModelServiceOverride>(MODEL_KEY);
  const adminKey = stored?.apiKey?.trim() ?? "";
  const envKey = (process.env.LLM_API_KEY ?? "").trim();
  const key = adminKey || envKey;
  const [counts] = await sql<{ rules: number; pending: number }[]>`
    SELECT (SELECT count(*)::int FROM analyses WHERE model = 'rules') AS rules,
           (SELECT count(*)::int FROM articles WHERE processing_state = 'new') AS pending`;
  return {
    baseUrl: (stored?.baseUrl ?? "").trim() || (process.env.LLM_BASE_URL ?? "").trim() || DEFAULT_BASE_URL,
    model: (stored?.model ?? "").trim() || (process.env.LLM_MODEL ?? "").trim() || DEFAULT_MODEL,
    keySet: key.length > 0,
    keyHint: key ? keyHint(key) : null,
    source: adminKey ? "admin" : envKey ? "env" : "none",
    analysisMode: getAnalysisMode(),
    rulesArticles: counts?.rules ?? 0,
    pendingArticles: counts?.pending ?? 0,
  };
}

/**
 * Switches how articles are judged. Saving takes effect within one poll interval in every process;
 * articles already judged keep their judgement, and pending ones are picked up by the sweep.
 */
export async function saveAnalysisMode(input: { mode: string }, actor: string): Promise<AdminModelService> {
  const mode = input.mode.trim() as AnalysisMode;
  if (!MODES.includes(mode)) throw new Error(`分析方式只能是 ${MODES.join(" / ")}`);
  const before = getAnalysisMode();
  await sql`INSERT INTO settings (key, value, updated_by) VALUES (${MODE_KEY}, ${sql.json({ mode } as never)}, ${actor})
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`;
  await audit(actor, "settings.analysis_mode", `settings:${MODE_KEY}`, null, { mode: before }, { mode });
  await refreshRuntimeSettings();
  return modelServiceView();
}

/**
 * Saves the model service. An empty key keeps the stored one; `clearKey` removes it, so the environment
 * value (if any) takes over again.
 */
export async function saveModelService(
  input: { baseUrl: string; model: string; apiKey?: string | null; clearKey?: boolean },
  actor: string,
): Promise<AdminModelService> {
  const before = await readSetting<ModelServiceOverride>(MODEL_KEY);
  const typed = (input.apiKey ?? "").trim();
  const apiKey = input.clearKey ? "" : typed || (before?.apiKey ?? "");
  const baseUrl = input.baseUrl.trim();
  const model = input.model.trim();
  if (!baseUrl && !apiKey && !model) throw new Error("接口地址、密钥、模型名至少填一项");

  const next: ModelServiceOverride = { baseUrl, model, apiKey };
  await sql`INSERT INTO settings (key, value, updated_by) VALUES (${MODEL_KEY}, ${sql.json(next as never)}, ${actor})
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`;
  await audit(actor, "settings.model_service", `settings:${MODEL_KEY}`, null,
    before ? { baseUrl: before.baseUrl, model: before.model, keySet: !!before.apiKey } : null,
    { baseUrl, model, keySet: !!apiKey });
  await refreshRuntimeSettings();
  return modelServiceView();
}

async function writeReleases(releases: AdminChangelogEntry[], actor: string, action: string, before: AdminChangelogEntry[]): Promise<void> {
  await sql`INSERT INTO settings (key, value, updated_by) VALUES (${CHANGELOG_KEY}, ${sql.json({ releases } as never)}, ${actor})
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`;
  await audit(actor, action, `settings:${CHANGELOG_KEY}`, null, { releases: before }, { releases });
  await refreshRuntimeSettings();
}

/** Publishes one entry from the admin; the date/time/title triple identifies it. */
export async function addChangelogRelease(
  input: { date: string; time: string; kind: string; title: string; body: string[] },
  actor: string,
): Promise<AdminChangelogEntry[]> {
  const date = input.date.trim();
  const time = input.time.trim() || "12:00";
  const title = input.title.trim();
  const kind = input.kind.trim() as AdminChangelogEntry["kind"];
  const body = input.body.map((line) => line.trim()).filter(Boolean);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("日期格式应为 2026-10-22");
  if (!/^\d{2}:\d{2}$/.test(time)) throw new Error("时间格式应为 09:30");
  if (!title) throw new Error("标题不能为空");
  if (!KINDS.includes(kind)) throw new Error(`类型只能是 ${KINDS.join(" / ")}`);

  const before = getAdminReleases();
  const rest = before.filter((r) => !(r.date === date && r.time === time && r.title === title));
  const next = [{ date, time, kind, title, body }, ...rest];
  await writeReleases(next, actor, "settings.changelog_add", before);
  return next;
}

export async function deleteChangelogRelease(input: { date: string; time: string; title: string }, actor: string): Promise<AdminChangelogEntry[]> {
  const before = getAdminReleases();
  const next = before.filter((r) => !(r.date === input.date && r.time === input.time && r.title === input.title));
  if (next.length === before.length) throw new Error("这条不是后台发布的记录，无法在这里删除");
  await writeReleases(next, actor, "settings.changelog_delete", before);
  return next;
}

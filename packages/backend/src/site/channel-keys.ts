// The four ways content comes in, and the keys two of them need (公众号 through Dajiala, X through
// SocialData). Keys are saved from the admin into the settings table and pulled into the collectors by
// the runtime poll, so enabling a channel does not need a file edit or a restart.
import { randomBytes } from "node:crypto";
import type { AdminChannels } from "@aihot/contracts/admin";
import { config } from "../config.ts";
import { sql } from "../db.ts";
import { audit } from "../audit.ts";
import { setCredentialOverrides } from "../runtime-overrides.ts";

const KEY = "collector_keys";

export interface CollectorKeys {
  dajialaKey: string;
  socialdataKey: string;
  ingestToken: string;
}

export async function readCollectorKeys(): Promise<CollectorKeys> {
  const rows = await sql<{ value: Partial<CollectorKeys> }[]>`SELECT value FROM settings WHERE key = ${KEY}`;
  const v = rows[0]?.value ?? {};
  return { dajialaKey: v.dajialaKey ?? "", socialdataKey: v.socialdataKey ?? "", ingestToken: v.ingestToken ?? "" };
}

/** Pushes the saved keys into this process's credential overrides. */
export async function applyCollectorKeys(): Promise<void> {
  const k = await readCollectorKeys();
  setCredentialOverrides({
    "collectors.DAJIALA_KEY": k.dajialaKey,
    "collectors.SOCIALDATA_API_KEY": k.socialdataKey,
    "auth.INGEST_TOKEN": k.ingestToken,
  });
}

const hintOf = (key: string) => (key.length >= 12 ? `${key.slice(0, 4)}…${key.slice(-4)}` : key ? "已设置" : null);

async function enabledCounts(): Promise<Record<string, number>> {
  const rows = await sql<{ kind: string; n: number }[]>`
    SELECT kind, count(*)::int AS n FROM sources WHERE enabled GROUP BY 1`;
  return Object.fromEntries(rows.map((r) => [r.kind, r.n]));
}

export async function channelsView(): Promise<AdminChannels> {
  const [keys, counts] = await Promise.all([readCollectorKeys(), enabledCounts()]);
  const envMp = (process.env.DAJIALA_KEY ?? "").trim();
  const envX = (process.env.SOCIALDATA_API_KEY ?? "").trim();
  const envIngest = (process.env.INGEST_TOKEN ?? "").trim();
  const mpKey = keys.dajialaKey || envMp;
  const xKey = keys.socialdataKey || envX;
  const ingest = keys.ingestToken || envIngest;
  return {
    mp: { ready: !!mpKey, hint: hintOf(mpKey), source: keys.dajialaKey ? "admin" : envMp ? "env" : "none", sources: counts.mp_account ?? 0 },
    x: { ready: !!xKey, hint: hintOf(xKey), source: keys.socialdataKey ? "admin" : envX ? "env" : "none", sources: counts.x_search ?? 0 },
    web: { sources: counts.web_list ?? 0 },
    ingest: { endpoint: `${config.siteUrl}/api/ingest/items`, token: ingest || null, sources: counts.external ?? 0 },
  };
}

export interface ChannelKeyInput {
  dajialaKey?: string | null;
  socialdataKey?: string | null;
  ingestToken?: string | null;
  /** Mints a fresh 48-character ingest token (the old one stops working). */
  generateIngest?: boolean;
  /** Channels whose stored key should be removed; the environment value, if any, takes over again. */
  clear?: Array<"mp" | "x" | "ingest">;
}

/** Empty strings leave a key untouched; clearing is explicit. */
export async function saveChannelKeys(input: ChannelKeyInput, actor: string): Promise<void> {
  const before = await readCollectorKeys();
  const clear = new Set(input.clear ?? []);
  const pick = (typed: string | null | undefined, current: string, name: "mp" | "x" | "ingest") => {
    if (clear.has(name)) return "";
    const value = (typed ?? "").trim();
    return value || current;
  };
  const next: CollectorKeys = {
    dajialaKey: pick(input.dajialaKey, before.dajialaKey, "mp"),
    socialdataKey: pick(input.socialdataKey, before.socialdataKey, "x"),
    ingestToken: input.generateIngest ? randomBytes(24).toString("hex") : pick(input.ingestToken, before.ingestToken, "ingest"),
  };
  await sql`INSERT INTO settings (key, value, updated_by) VALUES (${KEY}, ${sql.json(next as never)}, ${actor})
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`;
  await audit(actor, "settings.channel_keys", `settings:${KEY}`, null,
    { mp: !!before.dajialaKey, x: !!before.socialdataKey, ingest: !!before.ingestToken },
    { mp: !!next.dajialaKey, x: !!next.socialdataKey, ingest: !!next.ingestToken });
  await applyCollectorKeys();
}


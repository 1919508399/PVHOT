// Small site-wide facts for the web shell (e.g. the changelog red-dot anchor).
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ChangelogRelease, ChangelogResponse, SiteMeta } from "@aihot/contracts/site";
import { REPO_ROOT } from "../config.ts";
import { getAdminReleases } from "../runtime-overrides.ts";

let fileChangelog: ChangelogResponse | null = null;

/** Entries shipped with the site (site/changelog.json), newest first. */
function shippedChangelog(): ChangelogResponse {
  fileChangelog ??= JSON.parse(readFileSync(path.join(REPO_ROOT, "site/changelog.json"), "utf8")) as ChangelogResponse;
  return fileChangelog;
}

const stamp = (r: Pick<ChangelogRelease, "date" | "time">) => `${r.date}T${r.time || "00:00"}`;

/**
 * The changelog readers see: entries published from the admin (stored in the database and refreshed into
 * this process by the runtime poll) merged over the ones shipped with the site, newest first.
 */
export function loadChangelog(): ChangelogResponse {
  const shipped = shippedChangelog();
  const extra = getAdminReleases();
  if (extra.length === 0) return shipped;
  const seen = new Set<string>();
  const releases = [...extra, ...shipped.releases]
    .filter((r) => {
      const key = `${r.date}|${r.time}|${r.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => stamp(b).localeCompare(stamp(a)));
  return { latestVersion: releases[0] ? stamp(releases[0]) : shipped.latestVersion, releases };
}

export function siteMeta(): SiteMeta {
  return { changelogVersion: loadChangelog().latestVersion };
}

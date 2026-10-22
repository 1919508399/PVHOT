// Runtime overrides written from the admin (settings table) and refreshed in every backend process.
// Kept in its own module so config.ts can read them without importing the database.
import type { AdminChangelogEntry } from "@aihot/contracts/admin";

export interface ModelServiceOverride {
  baseUrl: string;
  model: string;
  apiKey: string;
}

let modelOverride: ModelServiceOverride | null = null;
let adminReleases: AdminChangelogEntry[] = [];
/** "rules" judges and writes every article without a model call; "model" is the normal pipeline. */
let analysisMode: "model" | "rules" = "model";
/** "<group>.<NAME>" → value, for collector keys and the ingest token set in the admin. */
const credentialOverrides = new Map<string, string>();

export function getAnalysisMode(): "model" | "rules" {
  return analysisMode;
}

export function setAnalysisMode(value: "model" | "rules"): void {
  analysisMode = value;
}

export function getModelOverride(): ModelServiceOverride | null {
  return modelOverride;
}

export function setModelOverride(value: ModelServiceOverride | null): void {
  modelOverride = value;
}

export function getAdminReleases(): AdminChangelogEntry[] {
  return adminReleases;
}

export function setAdminReleases(value: AdminChangelogEntry[]): void {
  adminReleases = value;
}

/** Replaces the whole override table; empty values remove the entry. */
export function setCredentialOverrides(values: Record<string, string>): void {
  credentialOverrides.clear();
  for (const [key, value] of Object.entries(values)) if (value && value.trim() !== "") credentialOverrides.set(key, value.trim());
}

export function getCredentialOverride(group: string, name: string): string | null {
  return credentialOverrides.get(`${group}.${name}`) ?? null;
}

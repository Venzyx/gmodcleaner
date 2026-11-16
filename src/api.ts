import { invoke } from "@tauri-apps/api/core";

export type Section = "workshop" | "addons" | "server" | "cache" | "other";

export interface Item {
  path: string;
  name: string;
  section: Section;
  kind: "workshop" | "folder" | "gma" | "servergma" | "download" | "cache" | "map" | "userdata";
  size: number;
  files: number;
  modified: number;
  isDir: boolean;
  container: boolean;
  workshopId: string | null;
  gmaPath: string | null;
  legacy: boolean;
  title: string | null;
  addonType: string | null;
  tags: string[];
  note: string | null;
  members: string[];
}

export interface Config {
  gmodDir: string | null;
  toTrash: boolean;
  exportDir: string | null;
}

export interface AppInfo {
  config: Config;
  gmodDir: string | null;
  exportDir: string;
  error: string | null;
}

export interface ScanResult {
  items: Item[];
  diskFree: number;
  diskTotal: number;
  gmodDir: string;
}

export interface Details {
  id: string;
  found: boolean;
  title: string;
  description: string;
  preview: string;
  size: number;
  updated: number;
  tags: string[];
  appId: number;
  /** Yapımcının SteamID64'ü. */
  creator: string;
}

export interface GmaMeta {
  title: string;
  description: string;
  author: string;
  addonType: string;
  tags: string[];
  timestamp: number;
  compressed: boolean;
}

export interface Entry {
  name: string;
  size: number;
}

export interface Inspect {
  meta: GmaMeta | null;
  entries: Entry[];
  totalFiles: number;
  truncated: boolean;
}

export interface Preview {
  kind: "text" | "image" | "none";
  text: string | null;
  dataUrl: string | null;
  truncated: boolean;
}

export interface OpResult {
  path: string;
  ok: boolean;
  error: string | null;
  warning: string | null;
  output: string | null;
}

export interface SteamStatus {
  connected: boolean;
  name: string;
  error: string | null;
}

export interface Resolved {
  id: string;
  kind: "item" | "collection";
  title: string;
  preview: string;
  items: Details[];
}

export interface Published {
  id: string;
  title: string;
  preview: string;
  updated: number;
  tags: string[];
}

export interface PublishPreview {
  files: number;
  size: number;
  skipped: string[];
  skippedCount: number;
  title: string | null;
  addonType: string | null;
  tags: string[];
  ignore: string[];
}

export interface PublishRequest {
  folder: string;
  title: string;
  description: string;
  addonType: string;
  tags: string[];
  ignore: string[];
  icon: string | null;
  existingId: string | null;
  changeNote: string;
  visibility: string;
}

export interface PublishResult {
  id: string;
  needsAgreement: boolean;
  files: number;
}

export interface Task {
  kind: "delete" | "export" | "download" | "publish";
  index: number;
  total: number;
  label: string;
  fraction: number;
}

export type ExportMode = "extract" | "gma";

export const api = {
  info: () => invoke<AppInfo>("get_info"),
  setConfig: (config: Config) => invoke<AppInfo>("set_config", { config }),
  scan: () => invoke<ScanResult>("scan_all"),
  inspect: (path: string, gmaPath: string | null) => invoke<Inspect>("inspect_item", { path, gmaPath }),
  readEntry: (path: string, gmaPath: string | null, name: string) =>
    invoke<Preview>("read_entry", { path, gmaPath, name }),
  deleteItems: (
    items: { path: string; workshopId: string | null; container: boolean }[],
    toTrash: boolean,
    allowWithoutSteam: boolean,
  ) => invoke<OpResult[]>("delete_items", { items, toTrash, allowWithoutSteam }),
  exportItems: (items: { gmaPath: string; name: string }[], dest: string, mode: ExportMode) =>
    invoke<OpResult[]>("export_items", { items, dest, mode }),
  downloadExport: (items: { id: string; title: string }[], dest: string, mode: ExportMode, keep: boolean) =>
    invoke<OpResult[]>("download_export", { items, dest, mode, keep }),
  details: (ids: string[], refresh = false) => invoke<Details[]>("workshop_details", { ids, refresh }),
  author: (steamId: string) => invoke<string>("steam_author", { steamId }),
  resolveLink: (input: string) => invoke<Resolved>("resolve_link", { input }),
  steamStatus: () => invoke<SteamStatus>("steam_status"),
  steamConnect: () => invoke<SteamStatus>("steam_connect"),
  steamDisconnect: () => invoke<SteamStatus>("steam_disconnect"),
  steamSubscribed: () => invoke<string[]>("steam_subscribed"),
  myPublished: () => invoke<Published[]>("my_published"),
  publishPreview: (folder: string, ignore: string[] | null) =>
    invoke<PublishPreview>("publish_preview", { folder, ignore }),
  publish: (request: PublishRequest) => invoke<PublishResult>("publish", { request }),
};

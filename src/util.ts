import type { Details, Item, Section } from "./api";

const nf1 = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });

export function bytes(n: number): string {
  if (n >= 1024 ** 3) return `${nf1.format(n / 1024 ** 3)} GB`;
  if (n >= 1024 ** 2) return `${(n >= 100 * 1024 ** 2 ? nf0 : nf1).format(n / 1024 ** 2)} MB`;
  if (n >= 1024) return `${nf0.format(n / 1024)} KB`;
  return `${n} B`;
}

export const count = (n: number) => nf0.format(n);

export function date(unix: number): string {
  if (!unix) return "—";
  return new Date(unix * 1000).toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" });
}

/** Steam açıklamalarındaki BBCode etiketlerini temizler. */
export function stripBB(text: string): string {
  return text
    .replace(/\[\/?[a-z0-9*]+(=[^\]]*)?\]/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function displayTitle(item: Item, details?: Details): string {
  return (details?.found && details.title) || item.title || item.name;
}

export const SECTIONS: { key: Section; label: string; hint: string; color: string }[] = [
  { key: "workshop", label: "Workshop", hint: "Steam'in indirdiği abonelikler ve workshop öğeleri", color: "var(--accent)" },
  { key: "addons", label: "Addons klasörü", hint: "garrysmod/addons içine elle konan addonlar", color: "var(--purple)" },
  { key: "server", label: "Sunucu içerikleri", hint: "Sunuculara girerken inen addonlar ve dosyalar", color: "var(--warn)" },
  { key: "cache", label: "Önbellek", hint: "Güvenle silinebilen geçici dosyalar", color: "var(--teal)" },
  { key: "other", label: "Diğer", hint: "Haritalar, kayıtlar, demolar ve addon verileri", color: "var(--success)" },
];

export const sectionOf = (key: Section) => SECTIONS.find((s) => s.key === key)!;

export const ADDON_TYPES = [
  "gamemode",
  "map",
  "weapon",
  "vehicle",
  "npc",
  "entity",
  "tool",
  "effects",
  "model",
  "servercontent",
];

export const ADDON_TAGS = ["fun", "roleplay", "scenic", "movie", "realism", "cartoon", "water", "comic", "build"];

export const workshopUrl = (id: string) => `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`;

export function errorText(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
}

import {
  ChevronRight,
  Database,
  Download,
  FileArchive,
  Folder,
  FolderOutput,
  Map as MapIcon,
  Package,
  RefreshCw,
  Search,
  Server,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { Ctx } from "../App";
import type { Details, Item, Section } from "../api";
import { Badge, Button, Card, Checkmark, IconButton, Segmented, Tile } from "../ui";
import { bytes, count, date, displayTitle, sectionOf } from "../util";

type Sort = "size" | "name" | "date";
type SubFilter = "all" | "sub" | "nosub";

const KIND: Record<Item["kind"], { color: string; icon: React.ReactNode; label: string }> = {
  workshop: { color: "var(--accent)", icon: <Package size={20} />, label: "Workshop" },
  folder: { color: "var(--purple)", icon: <Folder size={20} />, label: "Klasör" },
  gma: { color: "var(--indigo)", icon: <FileArchive size={20} />, label: "GMA" },
  servergma: { color: "var(--warn)", icon: <Server size={20} />, label: "Sunucu addonu" },
  download: { color: "var(--warn)", icon: <Download size={20} />, label: "İndirilen" },
  cache: { color: "var(--teal)", icon: <Database size={20} />, label: "Önbellek" },
  map: { color: "var(--success)", icon: <MapIcon size={20} />, label: "Harita" },
  userdata: { color: "var(--pink)", icon: <UserRound size={20} />, label: "Kullanıcı verisi" },
};

export function Thumb({ item, details, size = 44 }: { item: Item; details?: Details; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (details?.preview && !broken) {
    return (
      <img
        src={details.preview}
        alt=""
        loading="lazy"
        draggable={false}
        onError={() => setBroken(true)}
        className="shrink-0 bg-fill object-cover"
        style={{ width: size, height: size, borderRadius: size * 0.25 }}
      />
    );
  }
  const k = KIND[item.kind];
  return (
    <Tile color={k.color} size={size}>
      {k.icon}
    </Tile>
  );
}

export function subtitle(item: Item): string {
  const parts: string[] = [];
  if (item.kind === "workshop" && item.workshopId) parts.push(`#${item.workshopId}`);
  else if (item.title && item.title !== item.name && !item.note) parts.push(item.name);
  if (item.addonType) parts.push(item.addonType);
  if (item.files > 0 && item.kind !== "map") parts.push(`${count(item.files)} dosya`);
  return parts.join(" · ");
}

export function ItemsPage({ ctx, section }: { ctx: Ctx; section: Section }) {
  const meta = sectionOf(section);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("size");
  const [filter, setFilter] = useState<SubFilter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const all = useMemo(() => ctx.items.filter((i) => i.section === section), [ctx.items, section]);

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr");
    const title = (i: Item) => displayTitle(i, i.workshopId ? ctx.details[i.workshopId] : undefined);
    let list = all.filter((i) => {
      if (filter !== "all" && ctx.subscribed && i.workshopId) {
        if (ctx.subscribed.has(i.workshopId) !== (filter === "sub")) return false;
      }
      if (!q) return true;
      return (
        title(i).toLocaleLowerCase("tr").includes(q) ||
        i.name.toLowerCase().includes(q) ||
        (i.addonType ?? "").includes(q) ||
        i.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
    list = [...list].sort((a, b) =>
      sort === "size" ? b.size - a.size : sort === "date" ? b.modified - a.modified : title(a).localeCompare(title(b), "tr"),
    );
    return list;
  }, [all, query, sort, filter, ctx.details, ctx.subscribed]);

  const chosen = useMemo(() => all.filter((i) => selected.has(i.path)), [all, selected]);
  const chosenSize = chosen.reduce((a, b) => a + b.size, 0);
  const totalSize = all.reduce((a, b) => a + b.size, 0);
  const allVisibleSelected = visible.length > 0 && visible.every((i) => selected.has(i.path));

  const toggle = (path: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(path)) n.delete(path);
      else n.add(path);
      return n;
    });

  const toggleAll = () =>
    setSelected((s) => {
      const n = new Set(s);
      for (const i of visible) {
        if (allVisibleSelected) n.delete(i.path);
        else n.add(i.path);
      }
      return n;
    });

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 px-7 pt-6 pb-3">
        <div className="flex items-end gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-[26px] leading-tight font-bold tracking-tight">{meta.label}</h1>
            <p className="tabular mt-0.5 text-[13px] text-muted">
              {count(all.length)} öğe · {bytes(totalSize)} · {meta.hint}
            </p>
          </div>
          <IconButton label="Yeniden tara" onClick={ctx.rescan} disabled={ctx.scanning}>
            <RefreshCw size={16} className={ctx.scanning ? "animate-spin" : ""} />
          </IconButton>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          <label className="flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-xl bg-fill px-3 text-muted focus-within:ring-2 focus-within:ring-accent/50">
            <Search size={15} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ara"
              aria-label="Listede ara"
              className="selectable min-w-0 flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-muted"
            />
            {query && (
              <button onClick={() => setQuery("")} aria-label="Aramayı temizle" className="rounded-full hover:text-ink">
                <X size={14} />
              </button>
            )}
          </label>
          {section === "workshop" && ctx.subscribed && (
            <Segmented<SubFilter>
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "Tümü" },
                { value: "sub", label: "Abone" },
                { value: "nosub", label: "Abone değil" },
              ]}
            />
          )}
          <Segmented<Sort>
            value={sort}
            onChange={setSort}
            options={[
              { value: "size", label: "Boyut" },
              { value: "name", label: "Ad" },
              { value: "date", label: "Tarih" },
            ]}
          />
          <Button variant="plain" size="sm" onClick={toggleAll} disabled={!visible.length}>
            {allVisibleSelected ? "Seçimi kaldır" : "Tümünü seç"}
          </Button>
        </div>
      </header>

      <div className="scroll-area min-h-0 flex-1 overflow-y-auto px-7 pb-28">
        {visible.length === 0 ? (
          <div className="grid h-64 place-items-center text-center text-[13.5px] text-muted">
            {all.length === 0 ? "Burada yer kaplayan bir şey yok." : "Aramayla eşleşen öğe yok."}
          </div>
        ) : (
          <Card className="overflow-hidden">
            {visible.map((item, idx) => {
              const d = item.workshopId ? ctx.details[item.workshopId] : undefined;
              const isSel = selected.has(item.path);
              const isSub = item.kind === "workshop" && item.workshopId && ctx.subscribed?.has(item.workshopId);
              return (
                <div
                  key={item.path}
                  className={`group relative flex h-[62px] items-center gap-3 pr-2 pl-3 transition-colors duration-100 ${
                    isSel ? "bg-accent/8" : "hover:bg-fill/45"
                  }`}
                >
                  <button
                    onClick={() => toggle(item.path)}
                    aria-label={isSel ? "Seçimi kaldır" : "Seç"}
                    aria-pressed={isSel}
                    className="grid h-9 w-8 shrink-0 place-items-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                  >
                    <Checkmark checked={isSel} />
                  </button>
                  <button
                    onClick={() => ctx.openDetail(item)}
                    className="flex h-full min-w-0 flex-1 items-center gap-3 text-left outline-none"
                  >
                    <Thumb item={item} details={d} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[14px] font-medium">{displayTitle(item, d)}</span>
                        {isSub && <Badge color="var(--accent)">Abone</Badge>}
                        {item.legacy && <Badge>Eski biçim</Badge>}
                      </span>
                      <span className="tabular block truncate text-[12px] text-muted">{item.note ?? subtitle(item)}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="tabular block text-[13.5px] font-semibold">{bytes(item.size)}</span>
                      <span className="block text-[11.5px] text-muted">{date(item.modified)}</span>
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center opacity-0 transition-opacity duration-100 group-focus-within:opacity-100 group-hover:opacity-100">
                    {item.gmaPath && (
                      <IconButton label="Dışa aktar" onClick={() => ctx.askExport([item])}>
                        <FolderOutput size={16} />
                      </IconButton>
                    )}
                    <IconButton label="Sil" danger onClick={() => ctx.askDelete([item])}>
                      <Trash2 size={16} />
                    </IconButton>
                  </div>
                  <ChevronRight size={15} className="shrink-0 text-muted/50" />
                  {idx < visible.length - 1 && <span className="absolute right-0 bottom-0 left-[104px] border-b border-line" />}
                </div>
              );
            })}
          </Card>
        )}
      </div>

      {chosen.length > 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-5 z-20 flex justify-center px-6">
          <div className="pointer-events-auto flex animate-rise items-center gap-2 rounded-[18px] border border-line bg-bar py-2 pr-2 pl-4 shadow-pop backdrop-blur-xl">
            <span className="tabular mr-2 text-[13.5px]">
              <b className="font-semibold">{count(chosen.length)} öğe</b>
              <span className="text-muted"> · {bytes(chosenSize)}</span>
            </span>
            {chosen.some((i) => i.gmaPath) && (
              <Button variant="tinted" icon={<FolderOutput size={15} />} onClick={() => ctx.askExport(chosen)}>
                Dışa aktar
              </Button>
            )}
            <Button variant="danger" icon={<Trash2 size={15} />} onClick={() => ctx.askDelete(chosen)}>
              Sil
            </Button>
            <IconButton label="Seçimi temizle" onClick={() => setSelected(new Set())}>
              <X size={16} />
            </IconButton>
          </div>
        </div>
      )}
    </div>
  );
}

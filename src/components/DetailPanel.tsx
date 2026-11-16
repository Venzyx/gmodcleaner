import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { ChevronLeft, ChevronRight, ExternalLink, FileText, Folder, FolderOutput, FolderSearch, Image as ImageIcon, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Ctx } from "../App";
import { api, type Entry, type Inspect, type Item, type Preview } from "../api";
import { Badge, Button, Card, GroupLabel, IconButton, Modal, Row, Spinner } from "../ui";
import { bytes, count, date, displayTitle, errorText, stripBB, workshopUrl } from "../util";
import { Thumb, subtitle } from "./ItemsPage";

const PREVIEWABLE = /\.(png|jpe?g|gif|webp|lua|txt|json|vmt|cfg|properties|vdf|res|xml|csv|md|lst|qc|fgd|ini|html|css|js|vcd|kv|log)$/i;
const IMAGE = /\.(png|jpe?g|gif|webp)$/i;
const FOLDER_COLORS = ["var(--accent)", "var(--purple)", "var(--warn)", "var(--success)", "var(--pink)", "var(--teal)", "var(--indigo)"];

export function DetailPanel({ ctx, item, onClose }: { ctx: Ctx; item: Item; onClose: () => void }) {
  const d = item.workshopId ? ctx.details[item.workshopId] : undefined;
  const [inspect, setInspect] = useState<Inspect | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(150);
  const [entry, setEntry] = useState<Entry | null>(null);
  const [expanded, setExpanded] = useState(false);
  /** Gezilen klasör: "" kök, aksi halde "lua/autorun/" gibi sonu eğik çizgili yol. */
  const [cwd, setCwd] = useState("");
  const [author, setAuthor] = useState<string | null>(null);
  const listable = item.members.length === 0 && (item.gmaPath !== null || item.isDir);

  useEffect(() => {
    if (!listable) return;
    let alive = true;
    api
      .inspect(item.path, item.gmaPath)
      .then((r) => alive && setInspect(r))
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [item.path, item.gmaPath, listable]);

  const creator = d?.found ? d.creator : "";
  useEffect(() => {
    if (!creator) return;
    let alive = true;
    api
      .author(creator)
      .then((n) => alive && setAuthor(n))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [creator, ctx.steam.connected]);

  const folders = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of inspect?.entries ?? []) {
      const top = e.name.includes("/") ? e.name.slice(0, e.name.indexOf("/")) : "(kök)";
      m.set(top, (m.get(top) ?? 0) + e.size);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [inspect]);
  const folderTotal = folders.reduce((a, b) => a + b[1], 0) || 1;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (inspect?.entries ?? []).filter((e) => !q || e.name.toLowerCase().includes(q));
    return list.sort((a, b) => b.size - a.size);
  }, [inspect, query]);

  // Geçerli klasörün alt klasörleri ve dosyaları.
  const listing = useMemo(() => {
    const dirs = new Map<string, { size: number; files: number }>();
    const files: Entry[] = [];
    for (const e of inspect?.entries ?? []) {
      if (!e.name.startsWith(cwd)) continue;
      const rest = e.name.slice(cwd.length);
      const slash = rest.indexOf("/");
      if (slash < 0) {
        files.push(e);
      } else {
        const name = rest.slice(0, slash);
        const cur = dirs.get(name) ?? { size: 0, files: 0 };
        cur.size += e.size;
        cur.files += 1;
        dirs.set(name, cur);
      }
    }
    return {
      dirs: [...dirs.entries()].sort((a, b) => a[0].localeCompare(b[0])),
      files: files.sort((a, b) => a.name.localeCompare(b.name)),
    };
  }, [inspect, cwd]);
  const searching = query.trim().length > 0;
  const shownFiles = searching ? filtered : listing.files;
  const parent = cwd ? cwd.slice(0, cwd.slice(0, -1).lastIndexOf("/") + 1) : "";
  const gmaAuthor = inspect?.meta?.author && inspect.meta.author !== "Author Name" ? inspect.meta.author : "";
  const authorName = author || gmaAuthor;

  const rawDescription = stripBB((d?.found && d.description) || inspect?.meta?.description || "");
  // gmad'in varsayılan yer tutucusunu gösterme.
  const description = rawDescription.toLowerCase() === "description" ? "" : rawDescription;
  const tags = [...new Set([...(d?.tags ?? []), ...item.tags, item.addonType ?? ""].filter(Boolean).map((t) => t.toLowerCase()))].filter(
    (t) => t !== "addon",
  );
  const isSub = item.kind === "workshop" && item.workshopId && ctx.subscribed?.has(item.workshopId);

  return (
    <aside className="absolute inset-y-0 right-0 z-30 flex w-[440px] max-w-full animate-slide-in flex-col border-l border-line bg-bg shadow-pop">
      <div className="flex shrink-0 items-center justify-between px-4 pt-3.5 pb-1">
        <span className="text-[13px] font-medium text-muted">Ayrıntılar</span>
        <IconButton label="Kapat" onClick={onClose}>
          <X size={17} />
        </IconButton>
      </div>

      <div className="scroll-area min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-5">
        {d?.preview && (
          <img src={d.preview} alt="" draggable={false} className="aspect-[16/10] w-full rounded-2xl bg-fill object-cover shadow-soft" />
        )}

        <div className="flex items-start gap-3 px-1">
          {!d?.preview && <Thumb item={item} size={52} />}
          <div className="min-w-0 flex-1">
            <h2 className="selectable text-[19px] leading-snug font-semibold break-words">{displayTitle(item, d)}</h2>
            <p className="tabular mt-0.5 text-[12.5px] text-muted">{subtitle(item) || item.name}</p>
            {(tags.length > 0 || isSub || item.legacy) && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {isSub && <Badge color="var(--accent)">Abone</Badge>}
                {item.legacy && <Badge>Eski biçim</Badge>}
                {tags.map((t) => (
                  <Badge key={t} color="var(--purple)">
                    {t}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>

        {item.note && <p className="rounded-2xl bg-accent/10 px-3.5 py-3 text-[12.5px] leading-snug">{item.note}</p>}

        <div className="grid grid-cols-2 gap-2">
          {item.gmaPath && (
            <Button variant="tinted" icon={<FolderOutput size={15} />} onClick={() => ctx.askExport([item])}>
              Dışa aktar
            </Button>
          )}
          <Button icon={<FolderSearch size={15} />} onClick={() => revealItemInDir(item.gmaPath ?? item.path)}>
            Klasörde göster
          </Button>
          {item.workshopId && (
            <Button icon={<ExternalLink size={15} />} onClick={() => openUrl(workshopUrl(item.workshopId!))}>
              Workshop sayfası
            </Button>
          )}
          <Button variant="dangerTinted" icon={<Trash2 size={15} />} onClick={() => ctx.askDelete([item])}>
            Sil
          </Button>
        </div>

        <Card>
          <Row label="Boyut">
            <span className="tabular text-[13.5px] text-muted">{bytes(item.size)}</span>
          </Row>
          <Row label="Dosya sayısı">
            <span className="tabular text-[13.5px] text-muted">{count(inspect?.totalFiles ?? item.files)}</span>
          </Row>
          {(authorName || creator) && (
            <Row label="Yapımcı">
              {creator ? (
                <button
                  onClick={() => openUrl(`https://steamcommunity.com/profiles/${creator}`)}
                  className="max-w-[250px] truncate text-[13.5px] text-accent hover:underline"
                >
                  {authorName || "Steam profili"}
                </button>
              ) : (
                <span className="max-w-[250px] truncate text-[13.5px] text-muted">{authorName}</span>
              )}
            </Row>
          )}
          <Row label="Değiştirilme">
            <span className="text-[13.5px] text-muted">{date(item.modified)}</span>
          </Row>
          {d?.found && d.updated > 0 && (
            <Row label="Workshop güncellemesi">
              <span className="text-[13.5px] text-muted">{date(d.updated)}</span>
            </Row>
          )}
          <Row label="Konum" last>
            <span className="selectable max-w-[250px] truncate text-[12px] text-muted" dir="rtl" title={item.path}>
              {item.path}
            </span>
          </Row>
        </Card>

        {description && (
          <div>
            <GroupLabel>Açıklama</GroupLabel>
            <Card className="px-4 py-3">
              <p className={`selectable text-[13px] leading-relaxed whitespace-pre-wrap ${expanded ? "" : "line-clamp-4"}`}>{description}</p>
              {description.length > 220 && (
                <button onClick={() => setExpanded(!expanded)} className="mt-1.5 text-[12.5px] font-medium text-accent">
                  {expanded ? "Daha az" : "Devamını göster"}
                </button>
              )}
            </Card>
          </div>
        )}

        {listable && (
          <div>
            <GroupLabel>İçerik</GroupLabel>
            {error ? (
              <Card className="px-4 py-3 text-[13px] text-danger">{error}</Card>
            ) : !inspect ? (
              <Card className="flex items-center gap-2.5 px-4 py-4 text-[13px] text-muted">
                <Spinner size={16} /> Dosyalar okunuyor…
              </Card>
            ) : inspect.entries.length === 0 ? (
              <Card className="px-4 py-3 text-[13px] text-muted">Boş.</Card>
            ) : (
              <>
                <Card className="mb-2.5 px-4 py-3.5">
                  <div className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full">
                    {folders.slice(0, 7).map(([name, size], i) => (
                      <div key={name} title={`${name} · ${bytes(size)}`} style={{ width: `${(size / folderTotal) * 100}%`, background: FOLDER_COLORS[i] }} />
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
                    {folders.slice(0, 7).map(([name, size], i) => (
                      <button
                        key={name}
                        onClick={() => {
                          setQuery("");
                          setLimit(150);
                          setCwd(name === "(kök)" ? "" : `${name}/`);
                        }}
                        className="tabular flex items-center gap-1.5 text-[12px] hover:underline"
                      >
                        <span className="h-2 w-2 rounded-full" style={{ background: FOLDER_COLORS[i] }} />
                        {name} <span className="text-muted">{bytes(size)}</span>
                      </button>
                    ))}
                  </div>
                </Card>

                <label className="mb-2.5 flex h-9 items-center gap-2 rounded-xl bg-fill px-3 text-muted focus-within:ring-2 focus-within:ring-accent/50">
                  <Search size={15} />
                  <input
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setLimit(150);
                    }}
                    placeholder="Tüm dosyalarda ara"
                    aria-label="Dosyalarda ara"
                    className="selectable min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-muted"
                  />
                </label>

                <Card className="overflow-hidden">
                  {!searching && cwd && (
                    <button
                      onClick={() => {
                        setCwd(parent);
                        setLimit(150);
                      }}
                      className="flex h-11 w-full items-center gap-2 border-b border-line bg-fill/40 pr-3.5 pl-2.5 text-left hover:bg-fill/70"
                    >
                      <ChevronLeft size={17} className="shrink-0 text-accent" />
                      <span className="shrink-0 text-[13px] font-medium text-accent">Geri</span>
                      <span className="selectable min-w-0 flex-1 truncate text-right text-[12px] text-muted" title={cwd}>
                        {cwd.slice(0, -1)}
                      </span>
                    </button>
                  )}
                  {!searching &&
                    listing.dirs.map(([name, info]) => (
                      <button
                        key={name}
                        onClick={() => {
                          setCwd(`${cwd}${name}/`);
                          setLimit(150);
                        }}
                        className="flex h-11 w-full items-center gap-2.5 border-b border-line px-3.5 text-left last:border-b-0 hover:bg-fill/50"
                      >
                        <Folder size={16} className="shrink-0 text-accent" fill="currentColor" fillOpacity={0.18} />
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{name}</span>
                        <span className="tabular shrink-0 text-[11.5px] text-muted">
                          {count(info.files)} dosya · {bytes(info.size)}
                        </span>
                        <ChevronRight size={14} className="shrink-0 text-muted/50" />
                      </button>
                    ))}
                  {shownFiles.slice(0, limit).map((e) => {
                    const can = PREVIEWABLE.test(e.name);
                    const slash = e.name.lastIndexOf("/");
                    return (
                      <button
                        key={e.name}
                        disabled={!can}
                        onClick={() => setEntry(e)}
                        className={`flex min-h-11 w-full items-center gap-2.5 border-b border-line px-3.5 py-1.5 text-left last:border-b-0 ${can ? "hover:bg-fill/50" : ""}`}
                      >
                        {IMAGE.test(e.name) ? (
                          <ImageIcon size={16} className="shrink-0 text-accent" />
                        ) : (
                          <FileText size={16} className={`shrink-0 ${can ? "text-accent" : "text-muted/60"}`} />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px]">{e.name.slice(slash + 1)}</span>
                          {searching && slash > 0 && <span className="block truncate text-[11px] text-muted">{e.name.slice(0, slash)}</span>}
                        </span>
                        <span className="tabular shrink-0 text-[12px] text-muted">{bytes(e.size)}</span>
                      </button>
                    );
                  })}
                  {searching && filtered.length === 0 && <div className="px-4 py-3 text-[13px] text-muted">Eşleşen dosya yok.</div>}
                </Card>
                {shownFiles.length > limit && (
                  <div className="mt-2.5 text-center">
                    <Button size="sm" variant="plain" onClick={() => setLimit(limit + 500)}>
                      {count(shownFiles.length - limit)} dosya daha göster
                    </Button>
                  </div>
                )}
                {inspect.truncated && (
                  <p className="mt-2 px-1 text-[11.5px] text-muted">Liste ilk {count(inspect.entries.length)} dosyayla sınırlandı.</p>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {entry && <EntryPreview item={item} entry={entry} onClose={() => setEntry(null)} />}
    </aside>
  );
}

function EntryPreview({ item, entry, onClose }: { item: Item; entry: Entry; onClose: () => void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .readEntry(item.path, item.gmaPath, entry.name)
      .then(setPreview)
      .catch((e) => setError(errorText(e)));
  }, [item.path, item.gmaPath, entry.name]);

  return (
    <Modal onClose={onClose} width={760}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="selectable truncate text-[15px] font-semibold">{entry.name}</h3>
          <p className="tabular text-[12px] text-muted">{bytes(entry.size)}</p>
        </div>
        <IconButton label="Kapat" onClick={onClose}>
          <X size={17} />
        </IconButton>
      </div>
      {error ? (
        <p className="text-[13px] text-danger">{error}</p>
      ) : !preview ? (
        <div className="flex items-center gap-2.5 py-8 text-[13px] text-muted">
          <Spinner size={16} /> Yükleniyor…
        </div>
      ) : preview.kind === "image" ? (
        <div className="grid place-items-center rounded-2xl bg-fill/60 p-3">
          <img src={preview.dataUrl!} alt={entry.name} className="max-h-[60vh] max-w-full rounded-lg object-contain" />
        </div>
      ) : preview.kind === "text" ? (
        <>
          <pre className="scroll-area selectable max-h-[60vh] overflow-auto rounded-2xl bg-fill/60 p-4 font-mono text-[12px] leading-relaxed whitespace-pre-wrap">
            {preview.text}
          </pre>
          {preview.truncated && <p className="mt-2 text-[11.5px] text-muted">Dosya büyük olduğu için yalnızca başı gösteriliyor.</p>}
        </>
      ) : (
        <p className="py-6 text-[13px] text-muted">Bu dosya önizlenemiyor{preview.truncated ? " (çok büyük)" : ""}.</p>
      )}
    </Modal>
  );
}

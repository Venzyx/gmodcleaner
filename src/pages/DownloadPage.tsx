import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { CheckCircle2, CloudDownload, ExternalLink, Link2, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import type { Ctx } from "../App";
import { api, type ExportMode, type OpResult, type Resolved } from "../api";
import { DestinationPicker, MODE_OPTIONS } from "../components/Dialogs";
import { Badge, Button, Card, Checkmark, GroupLabel, Row, Segmented, Switch } from "../ui";
import { bytes, count, errorText, workshopUrl } from "../util";

export function DownloadPage({ ctx }: { ctx: Ctx }) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dest, setDest] = useState(ctx.info?.exportDir ?? "");
  const [mode, setMode] = useState<ExportMode>("extract");
  const [keep, setKeep] = useState(false);
  const [results, setResults] = useState<Record<string, OpResult>>({});

  const installed = useMemo(() => new Set(ctx.items.filter((i) => i.workshopId).map((i) => i.workshopId!)), [ctx.items]);

  const fetchLink = async () => {
    if (!input.trim()) return;
    setLoading(true);
    setError(null);
    setResults({});
    try {
      const r = await api.resolveLink(input);
      setResolved(r);
      setSelected(new Set(r.items.filter((i) => i.found).map((i) => i.id)));
    } catch (e) {
      setResolved(null);
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  };

  const chosen = resolved?.items.filter((i) => selected.has(i.id)) ?? [];
  const chosenSize = chosen.reduce((a, b) => a + b.size, 0);

  const start = async () => {
    const steam = ctx.steam.connected ? ctx.steam : await ctx.connectSteam();
    if (!steam.connected) {
      ctx.toast("error", steam.error ?? "Steam'e bağlanılamadı.");
      return;
    }
    const res = await ctx.run("İndiriliyor ve dışa aktarılıyor", () =>
      api.downloadExport(
        chosen.map((c) => ({ id: c.id, title: c.title })),
        dest,
        mode,
        keep,
      ),
    );
    if (!res) return;
    setResults(Object.fromEntries(res.map((r) => [r.path, r])));
    const good = res.filter((r) => r.ok);
    const bad = res.length - good.length;
    if (good.length) {
      ctx.toast("ok", `${count(good.length)} addon dışa aktarıldı${bad ? `, ${bad} başarısız` : ""}`, {
        label: "Klasörde göster",
        run: () => revealItemInDir(good[0].output!),
      });
    } else {
      ctx.toast("error", `Hiçbir addon aktarılamadı: ${res[0]?.error ?? ""}`);
    }
    ctx.rescan();
  };

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const selectable = resolved?.items.filter((i) => i.found) ?? [];
  const allSelected = selectable.length > 0 && selectable.every((i) => selected.has(i.id));

  return (
    <div className="scroll-area h-full overflow-y-auto px-7 pt-6 pb-10">
      <div className="mx-auto max-w-[860px]">
        <h1 className="text-[26px] leading-tight font-bold tracking-tight">İndir ve dışa aktar</h1>
        <p className="mt-0.5 text-[13px] text-muted">
          Bir Workshop addonunun ya da koleksiyonunun bağlantısını yapıştır; abone olmadan indirip dosyalarını çıkar.
        </p>

        <form
          className="mt-5 flex gap-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            fetchLink();
          }}
        >
          <label className="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-[14px] bg-surface px-3.5 shadow-soft focus-within:ring-2 focus-within:ring-accent/50">
            <Link2 size={17} className="shrink-0 text-muted" />
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="https://steamcommunity.com/sharedfiles/filedetails/?id=…"
              aria-label="Workshop bağlantısı ya da kimliği"
              className="selectable min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted"
            />
          </label>
          <Button type="submit" size="lg" variant="primary" busy={loading} disabled={!input.trim()}>
            Getir
          </Button>
        </form>
        {error && <p className="mt-2.5 px-1 text-[13px] text-danger">{error}</p>}

        {resolved && (
          <>
            <Card className="mt-5 flex items-center gap-3.5 p-3.5">
              {resolved.preview ? (
                <img src={resolved.preview} alt="" className="h-14 w-14 shrink-0 rounded-[14px] bg-fill object-cover" />
              ) : (
                <span className="grid h-14 w-14 shrink-0 place-items-center rounded-[14px] bg-pink text-white">
                  <CloudDownload size={24} />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[15.5px] font-semibold">{resolved.title || `#${resolved.id}`}</span>
                  <Badge color={resolved.kind === "collection" ? "var(--pink)" : "var(--accent)"}>
                    {resolved.kind === "collection" ? "Koleksiyon" : "Addon"}
                  </Badge>
                </div>
                <div className="tabular text-[12.5px] text-muted">
                  {count(resolved.items.length)} addon · {bytes(resolved.items.reduce((a, b) => a + b.size, 0))}
                </div>
              </div>
              <Button size="sm" icon={<ExternalLink size={13} />} onClick={() => openUrl(workshopUrl(resolved.id))}>
                Workshop'ta aç
              </Button>
            </Card>

            <div className="mt-5 mb-1.5 flex items-center justify-between">
              <GroupLabel>Addonlar</GroupLabel>
              {selectable.length > 1 && (
                <Button
                  size="sm"
                  variant="plain"
                  onClick={() => setSelected(allSelected ? new Set() : new Set(selectable.map((i) => i.id)))}
                >
                  {allSelected ? "Seçimi kaldır" : "Tümünü seç"}
                </Button>
              )}
            </div>
            <Card className="overflow-hidden">
              {resolved.items.map((it, idx) => {
                const r = results[it.id];
                return (
                  <button
                    key={it.id}
                    disabled={!it.found}
                    onClick={() => toggle(it.id)}
                    className="relative flex h-[58px] w-full items-center gap-3 px-3.5 text-left transition-colors hover:bg-fill/45 disabled:opacity-50"
                  >
                    <Checkmark checked={selected.has(it.id)} />
                    {it.preview ? (
                      <img src={it.preview} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded-[10px] bg-fill object-cover" />
                    ) : (
                      <span className="h-10 w-10 shrink-0 rounded-[10px] bg-fill" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[14px] font-medium">{it.found ? it.title : "Bulunamadı (silinmiş ya da gizli)"}</span>
                        {installed.has(it.id) && <Badge color="var(--success)">Yüklü</Badge>}
                      </span>
                      <span className={`tabular block truncate text-[12px] ${r?.error ? "text-danger" : "text-muted"}`}>
                        {r?.error ?? `#${it.id}`}
                      </span>
                    </span>
                    {r ? (
                      r.ok ? (
                        <CheckCircle2 size={18} className="shrink-0 text-success" />
                      ) : (
                        <XCircle size={18} className="shrink-0 text-danger" />
                      )
                    ) : (
                      <span className="tabular shrink-0 text-[13px] font-medium">{it.found ? bytes(it.size) : ""}</span>
                    )}
                    {idx < resolved.items.length - 1 && <span className="absolute right-0 bottom-0 left-[100px] border-b border-line" />}
                  </button>
                );
              })}
            </Card>

            <div className="mt-5">
              <GroupLabel>Seçenekler</GroupLabel>
              <Card>
                <Row label="Biçim" hint={mode === "extract" ? "Dosyalar addon başına bir klasöre çıkarılır." : "Her addon tek bir .gma dosyası olur."}>
                  <Segmented value={mode} onChange={setMode} options={MODE_OPTIONS} />
                </Row>
                <Row
                  label="İndirilen kopyayı Steam'de tut"
                  hint="Kapalıyken, yalnızca bu işlem için indirilen addonlar dışa aktarıldıktan sonra workshop klasöründen silinir."
                >
                  <Switch checked={keep} onChange={setKeep} label="İndirilen kopyayı tut" />
                </Row>
                <div className="p-3">
                  <DestinationPicker value={dest} onChange={setDest} />
                </div>
              </Card>
            </div>

            <div className="mt-5 flex items-center justify-between gap-4">
              <span className="tabular text-[13px] text-muted">
                {count(chosen.length)} addon seçildi · {bytes(chosenSize)}
              </span>
              <Button size="lg" variant="primary" icon={<CloudDownload size={17} />} disabled={!chosen.length || !dest} onClick={start}>
                İndir ve dışa aktar
              </Button>
            </div>
            {!ctx.steam.connected && (
              <p className="mt-2 text-right text-[12px] text-muted">İndirme için Steam'in açık olması gerekir; başlatınca bağlanılır.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

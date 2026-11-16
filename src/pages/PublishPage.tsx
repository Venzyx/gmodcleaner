import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AlertTriangle, CheckCircle2, ExternalLink, FolderOpen, ImagePlus, Upload } from "lucide-react";
import { useState } from "react";
import type { Ctx } from "../App";
import { api, type Published, type PublishPreview, type PublishResult } from "../api";
import { pickFolder } from "../components/Dialogs";
import { Button, Card, GroupLabel, Modal, Row, Segmented, Spinner, TextInput } from "../ui";
import { ADDON_TAGS, ADDON_TYPES, bytes, count, date, errorText, workshopUrl } from "../util";

type Mode = "new" | "update";

const VISIBILITY = [
  { value: "private", label: "Gizli" },
  { value: "unlisted", label: "Liste dışı" },
  { value: "friends", label: "Arkadaşlar" },
  { value: "public", label: "Herkese açık" },
];

export function PublishPage({ ctx }: { ctx: Ctx }) {
  const [mode, setMode] = useState<Mode>("new");
  const [folder, setFolder] = useState("");
  const [preview, setPreview] = useState<PublishPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [addonType, setAddonType] = useState("model");
  const [tags, setTags] = useState<string[]>([]);
  const [icon, setIcon] = useState<string | null>(null);
  const [existingId, setExistingId] = useState("");
  const [changeNote, setChangeNote] = useState("");
  const [visibility, setVisibility] = useState("private");
  const [mine, setMine] = useState<Published[] | null>(null);
  const [loadingMine, setLoadingMine] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<PublishResult | null>(null);
  const [showSkipped, setShowSkipped] = useState(false);

  const chooseFolder = async () => {
    const dir = await pickFolder(folder || undefined);
    if (!dir) return;
    setFolder(dir);
    setPreview(null);
    setPreviewError(null);
    setResult(null);
    try {
      const p = await api.publishPreview(dir, null);
      setPreview(p);
      if (p.title && !title) setTitle(p.title);
      if (p.addonType && ADDON_TYPES.includes(p.addonType)) setAddonType(p.addonType);
      if (p.tags.length) setTags(p.tags.filter((t) => ADDON_TAGS.includes(t)).slice(0, 2));
    } catch (e) {
      setPreviewError(errorText(e));
    }
  };

  const chooseIcon = async () => {
    const res = await open({ multiple: false, filters: [{ name: "Görsel", extensions: ["jpg", "jpeg", "png", "gif"] }] });
    if (typeof res === "string") setIcon(res);
  };

  const loadMine = async () => {
    setLoadingMine(true);
    try {
      const s = ctx.steam.connected ? ctx.steam : await ctx.connectSteam();
      if (!s.connected) throw s.error ?? "Steam'e bağlanılamadı.";
      setMine(await api.myPublished());
    } catch (e) {
      ctx.toast("error", errorText(e));
    } finally {
      setLoadingMine(false);
    }
  };

  const toggleTag = (t: string) =>
    setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : cur.length >= 2 ? [cur[1], t] : [...cur, t]));

  const ready =
    !!preview && preview.files > 0 && (mode === "new" ? title.trim().length > 0 : /\d{5,}/.test(existingId));

  const submit = async () => {
    setConfirming(false);
    const s = ctx.steam.connected ? ctx.steam : await ctx.connectSteam();
    if (!s.connected) {
      ctx.toast("error", s.error ?? "Steam'e bağlanılamadı.");
      return;
    }
    const res = await ctx.run("Workshop'a yükleniyor", () =>
      api.publish({
        folder,
        title,
        description,
        addonType,
        tags,
        ignore: preview?.ignore ?? [],
        icon,
        existingId: mode === "update" ? existingId : null,
        changeNote,
        visibility,
      }),
    );
    if (res) {
      setResult(res);
      ctx.toast("ok", mode === "new" ? "Addon Workshop'a yüklendi." : "Addon güncellendi.");
    }
  };

  return (
    <div className="scroll-area h-full overflow-y-auto px-7 pt-6 pb-10">
      <div className="mx-auto max-w-[760px]">
        <h1 className="text-[26px] leading-tight font-bold tracking-tight">Yayınla</h1>
        <p className="mt-0.5 text-[13px] text-muted">Bir addon klasörünü GMA olarak paketleyip Steam Workshop'a yükle.</p>

        <Segmented<Mode>
          className="mt-5 w-[300px]"
          value={mode}
          onChange={setMode}
          options={[
            { value: "new", label: "Yeni addon" },
            { value: "update", label: "Var olanı güncelle" },
          ]}
        />

        {result && (
          <Card className="mt-4 p-4">
            <div className="flex items-center gap-3">
              <CheckCircle2 size={22} className="shrink-0 text-success" />
              <div className="min-w-0 flex-1">
                <div className="text-[14.5px] font-semibold">Yükleme tamamlandı</div>
                <div className="tabular text-[12.5px] text-muted">
                  #{result.id} · {count(result.files)} dosya
                </div>
              </div>
              <Button variant="tinted" icon={<ExternalLink size={14} />} onClick={() => openUrl(workshopUrl(result.id))}>
                Workshop'ta aç
              </Button>
            </div>
            {result.needsAgreement && (
              <p className="mt-3 flex items-start gap-2 rounded-xl bg-warn/12 px-3 py-2.5 text-[12.5px] leading-snug">
                <AlertTriangle size={16} className="mt-px shrink-0 text-warn" />
                Addonun görünür olması için Steam Workshop yasal sözleşmesini kabul etmen gerekiyor. Workshop sayfasını açınca Steam sana gösterecek.
              </p>
            )}
          </Card>
        )}

        <div className="mt-5">
          <GroupLabel>Addon klasörü</GroupLabel>
          <Card>
            <div className="flex items-center gap-3 p-3.5">
              <FolderOpen size={18} className="shrink-0 text-muted" />
              <span className={`selectable min-w-0 flex-1 truncate text-[13px] ${folder ? "" : "text-muted"}`} title={folder}>
                {folder || "lua, models, materials… klasörlerini içeren addon klasörünü seç"}
              </span>
              <Button variant={folder ? "gray" : "primary"} onClick={chooseFolder}>
                {folder ? "Değiştir" : "Klasör seç"}
              </Button>
            </div>
            {previewError && <p className="border-t border-line px-4 py-3 text-[13px] text-danger">{previewError}</p>}
            {folder && !preview && !previewError && (
              <div className="flex items-center gap-2.5 border-t border-line px-4 py-3 text-[13px] text-muted">
                <Spinner size={15} /> Dosyalar taranıyor…
              </div>
            )}
            {preview && (
              <div className="border-t border-line px-4 py-3 text-[13px]">
                <span className="tabular">
                  <b className="font-semibold">{count(preview.files)} dosya</b> pakete girecek · {bytes(preview.size)}
                </span>
                {preview.skippedCount > 0 && (
                  <>
                    <button onClick={() => setShowSkipped(!showSkipped)} className="ml-2 text-accent">
                      {count(preview.skippedCount)} dosya atlanacak
                    </button>
                    {showSkipped && (
                      <div className="scroll-area selectable mt-2 max-h-40 overflow-y-auto rounded-xl bg-fill/60 p-3 font-mono text-[11.5px] leading-relaxed text-muted">
                        {preview.skipped.map((s) => (
                          <div key={s}>{s}</div>
                        ))}
                        {preview.skippedCount > preview.skipped.length && <div>…</div>}
                      </div>
                    )}
                    <p className="mt-1.5 text-[12px] leading-snug text-muted">
                      GMod yalnızca belirli klasör ve uzantılara izin verir; izin verilmeyenler ile addon.json'daki "ignore" kalıpları atlanır.
                    </p>
                  </>
                )}
                {preview.files === 0 && <p className="mt-1 text-danger">Bu klasörde GMod'un kabul ettiği dosya yok.</p>}
              </div>
            )}
          </Card>
        </div>

        {mode === "update" && (
          <div className="mt-5">
            <GroupLabel>Güncellenecek addon</GroupLabel>
            <Card>
              <div className="flex items-center gap-2.5 p-3.5">
                <TextInput
                  value={existingId}
                  onChange={(e) => setExistingId(e.target.value)}
                  placeholder="Workshop bağlantısı ya da kimliği"
                  aria-label="Güncellenecek addonun bağlantısı ya da kimliği"
                />
                <Button busy={loadingMine} onClick={loadMine}>
                  Yayınladıklarım
                </Button>
              </div>
              {mine && (
                <div className="scroll-area max-h-64 overflow-y-auto border-t border-line">
                  {mine.length === 0 && <p className="px-4 py-3 text-[13px] text-muted">Yayınlanmış GMod addonun yok.</p>}
                  {mine.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => {
                        setExistingId(m.id);
                        if (!title) setTitle(m.title);
                      }}
                      className={`flex w-full items-center gap-3 border-b border-line px-3.5 py-2 text-left last:border-b-0 hover:bg-fill/45 ${
                        existingId === m.id ? "bg-accent/8" : ""
                      }`}
                    >
                      {m.preview ? (
                        <img src={m.preview} alt="" className="h-9 w-9 shrink-0 rounded-[9px] bg-fill object-cover" />
                      ) : (
                        <span className="h-9 w-9 shrink-0 rounded-[9px] bg-fill" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium">{m.title}</span>
                        <span className="tabular block text-[11.5px] text-muted">
                          #{m.id} · {date(m.updated)}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </Card>
          </div>
        )}

        <div className="mt-5">
          <GroupLabel>Bilgiler</GroupLabel>
          <Card>
            <Row label="Başlık" hint={mode === "update" ? "Boş bırakırsan Workshop'taki başlık korunur." : undefined}>
              <TextInput
                className="!w-[380px]"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={128}
                placeholder="Addonun adı"
                aria-label="Başlık"
              />
            </Row>
            <Row label="Tür">
              <select
                value={addonType}
                onChange={(e) => setAddonType(e.target.value)}
                aria-label="Addon türü"
                className="h-9 w-[380px] rounded-xl bg-fill px-3 text-[13.5px] outline-none focus:ring-2 focus:ring-accent/50"
              >
                {ADDON_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Etiketler" hint="En fazla iki tane.">
              <div className="flex w-[380px] flex-wrap gap-1.5">
                {ADDON_TAGS.map((t) => (
                  <button
                    key={t}
                    onClick={() => toggleTag(t)}
                    aria-pressed={tags.includes(t)}
                    className={`h-7 rounded-full px-3 text-[12.5px] font-medium transition-colors ${
                      tags.includes(t) ? "bg-accent text-white" : "bg-fill text-ink hover:brightness-95"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </Row>
            <Row label="Önizleme görseli" hint="JPG, PNG ya da GIF; 1 MB'den küçük. Kare görsel önerilir.">
              <div className="flex w-[380px] items-center gap-2">
                <span className="selectable min-w-0 flex-1 truncate text-right text-[12.5px] text-muted" dir="rtl" title={icon ?? ""}>
                  {icon ?? (mode === "update" ? "Mevcut görsel korunur" : "Seçilmedi")}
                </span>
                {icon && (
                  <Button size="sm" onClick={() => setIcon(null)}>
                    Kaldır
                  </Button>
                )}
                <Button size="sm" icon={<ImagePlus size={14} />} onClick={chooseIcon}>
                  Seç
                </Button>
              </div>
            </Row>
            {mode === "new" && (
              <Row label="Görünürlük" hint="Gizli yükleyip Workshop sayfasında kontrol ettikten sonra açabilirsin.">
                <select
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value)}
                  aria-label="Görünürlük"
                  className="h-9 w-[380px] rounded-xl bg-fill px-3 text-[13.5px] outline-none focus:ring-2 focus:ring-accent/50"
                >
                  {VISIBILITY.map((v) => (
                    <option key={v.value} value={v.value}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </Row>
            )}
            <div className="border-b border-line p-3.5 last:border-b-0">
              <label className="mb-1.5 block text-[14px]" htmlFor="desc">
                Açıklama
              </label>
              <textarea
                id="desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder={mode === "update" ? "Boş bırakırsan Workshop'taki açıklama korunur." : "Addonun ne yaptığını anlat."}
                className="selectable scroll-area w-full resize-y rounded-xl bg-fill p-3 text-[13.5px] leading-relaxed outline-none placeholder:text-muted focus:ring-2 focus:ring-accent/50"
              />
            </div>
            {mode === "update" && (
              <div className="p-3.5">
                <label className="mb-1.5 block text-[14px]" htmlFor="note">
                  Değişiklik notu
                </label>
                <TextInput id="note" value={changeNote} onChange={(e) => setChangeNote(e.target.value)} placeholder="Bu güncellemede ne değişti?" />
              </div>
            )}
          </Card>
        </div>

        <div className="mt-5 flex items-center justify-end gap-4">
          {!ctx.steam.connected && <span className="text-[12px] text-muted">Yükleme için Steam'in açık olması gerekir.</span>}
          <Button size="lg" variant="primary" icon={<Upload size={17} />} disabled={!ready} onClick={() => setConfirming(true)}>
            {mode === "new" ? "Workshop'a yükle" : "Güncellemeyi yükle"}
          </Button>
        </div>
      </div>

      {confirming && preview && (
        <Modal onClose={() => setConfirming(false)}>
          <h2 className="text-[18px] font-semibold">{mode === "new" ? "Workshop'a yüklensin mi?" : "Addon güncellensin mi?"}</h2>
          <p className="tabular mt-1.5 text-[13.5px] leading-relaxed text-muted">
            {mode === "new" ? (
              <>
                <b className="font-semibold text-ink">{title}</b> adıyla, {VISIBILITY.find((v) => v.value === visibility)!.label.toLowerCase()} görünürlükte
                yeni bir Workshop addonu oluşturulacak.
              </>
            ) : (
              <>
                <b className="font-semibold text-ink">#{existingId.match(/\d{5,}/)?.[0]}</b> numaralı addonun içeriği bu klasörle değiştirilecek.
              </>
            )}{" "}
            {count(preview.files)} dosya · {bytes(preview.size)}.
          </p>
          <div className="mt-5 grid grid-cols-2 gap-2.5">
            <Button size="lg" onClick={() => setConfirming(false)}>
              Vazgeç
            </Button>
            <Button size="lg" variant="primary" onClick={submit}>
              Yükle
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

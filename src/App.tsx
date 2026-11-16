import { listen } from "@tauri-apps/api/event";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  CheckCircle2,
  CloudDownload,
  Database,
  FolderOpen,
  HardDrive,
  Info,
  Package,
  PieChart,
  RefreshCw,
  Server,
  Settings as SettingsIcon,
  Upload,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type AppInfo, type Details, type ExportMode, type Item, type ScanResult, type Section, type SteamStatus, type Task } from "./api";
import { DeleteDialog, ExportDialog } from "./components/Dialogs";
import { DetailPanel } from "./components/DetailPanel";
import { ItemsPage } from "./components/ItemsPage";
import { DownloadPage } from "./pages/DownloadPage";
import { Overview } from "./pages/Overview";
import { PublishPage } from "./pages/PublishPage";
import { SettingsPage } from "./pages/SettingsPage";
import { Button, Modal, ProgressBar, Spinner, Tile } from "./ui";
import { bytes, count, errorText, SECTIONS } from "./util";

export type Page = "overview" | Section | "download" | "publish" | "settings";

interface Toast {
  id: number;
  kind: "ok" | "error" | "info";
  text: string;
  action?: { label: string; run: () => void };
}

export interface Ctx {
  info: AppInfo | null;
  setInfo: (i: AppInfo) => void;
  scan: ScanResult | null;
  scanning: boolean;
  items: Item[];
  details: Record<string, Details>;
  subscribed: Set<string> | null;
  steam: SteamStatus;
  connectSteam: () => Promise<SteamStatus>;
  disconnectSteam: () => Promise<void>;
  rescan: () => Promise<void>;
  navigate: (p: Page) => void;
  openDetail: (item: Item) => void;
  askDelete: (items: Item[]) => void;
  askExport: (items: Item[]) => void;
  toast: (kind: Toast["kind"], text: string, action?: Toast["action"]) => void;
  /** Uzun süren bir işlemi ilerleme penceresiyle çalıştırır. */
  run: <T>(title: string, fn: () => Promise<T>) => Promise<T | undefined>;
}

const NAV: { key: Page; label: string; color: string; icon: React.ReactNode }[] = [
  { key: "overview", label: "Genel Bakış", color: "var(--indigo)", icon: <PieChart size={16} /> },
  { key: "workshop", label: "Workshop", color: "var(--accent)", icon: <Package size={16} /> },
  { key: "addons", label: "Addons", color: "var(--purple)", icon: <FolderOpen size={16} /> },
  { key: "server", label: "Sunucu içerikleri", color: "var(--warn)", icon: <Server size={16} /> },
  { key: "cache", label: "Önbellek", color: "var(--teal)", icon: <Database size={16} /> },
  { key: "other", label: "Diğer", color: "var(--success)", icon: <HardDrive size={16} /> },
];

const TOOLS: typeof NAV = [
  { key: "download", label: "İndir ve dışa aktar", color: "var(--pink)", icon: <CloudDownload size={16} /> },
  { key: "publish", label: "Yayınla", color: "var(--warn)", icon: <Upload size={16} /> },
  { key: "settings", label: "Ayarlar", color: "var(--muted)", icon: <SettingsIcon size={16} /> },
];

export default function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, Details>>({});
  const [subscribed, setSubscribed] = useState<Set<string> | null>(null);
  const [steam, setSteam] = useState<SteamStatus>({ connected: false, name: "", error: null });
  const [page, setPage] = useState<Page>("overview");
  const [detail, setDetail] = useState<Item | null>(null);
  const [toDelete, setToDelete] = useState<Item[] | null>(null);
  const [toExport, setToExport] = useState<Item[] | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [task, setTask] = useState<Task | null>(null);
  const toastId = useRef(0);

  const items = useMemo(() => scan?.items ?? [], [scan]);

  const toast = useCallback<Ctx["toast"]>((kind, text, action) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, kind, text, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 9000 : 5500);
  }, []);

  const rescan = useCallback(async () => {
    setScanning(true);
    try {
      const res = await api.scan();
      setScan(res);
      setScanError(null);
      const ids = res.items.filter((i) => i.workshopId).map((i) => i.workshopId!);
      if (ids.length) {
        api
          .details(ids)
          .then((list) => setDetails((d) => ({ ...d, ...Object.fromEntries(list.map((x) => [x.id, x])) })))
          .catch(() => {});
      }
    } catch (e) {
      setScan(null);
      setScanError(errorText(e));
    } finally {
      setScanning(false);
    }
  }, []);

  const refreshSubscribed = useCallback(async () => {
    setSubscribed(new Set(await api.steamSubscribed()));
  }, []);

  const connectSteam = useCallback(async () => {
    const s = await api.steamConnect();
    setSteam(s);
    if (s.connected) await refreshSubscribed();
    return s;
  }, [refreshSubscribed]);

  const disconnectSteam = useCallback(async () => {
    setSteam(await api.steamDisconnect());
    setSubscribed(null);
  }, []);

  useEffect(() => {
    api.info().then(setInfo);
    rescan();
    const un = listen<Task>("task", (e) => setTask(e.payload));
    return () => {
      un.then((f) => f());
    };
  }, [rescan]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !toDelete && !toExport && !busy) setDetail(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toDelete, toExport, busy]);

  const run = useCallback<Ctx["run"]>(
    async (title, fn) => {
      setTask(null);
      setBusy(title);
      try {
        return await fn();
      } catch (e) {
        toast("error", errorText(e));
        return undefined;
      } finally {
        setBusy(null);
        setTask(null);
      }
    },
    [toast],
  );

  const doDelete = async (list: Item[], toTrash: boolean, allowWithoutSteam: boolean) => {
    setToDelete(null);
    if (info && info.config.toTrash !== toTrash) {
      api.setConfig({ ...info.config, toTrash }).then(setInfo).catch(() => {});
    }
    const reqs = list.flatMap((it) =>
      it.members.length
        ? it.members.map((m) => ({ path: m, workshopId: null, container: false }))
        : [{ path: it.path, workshopId: it.kind === "workshop" ? it.workshopId : null, container: it.container }],
    );
    const res = await run("Siliniyor", () => api.deleteItems(reqs, toTrash, allowWithoutSteam));
    if (!res) return;
    const ok = new Map(res.map((r) => [r.path, r.ok]));
    const done = list.filter((it) => (it.members.length ? it.members.every((m) => ok.get(m)) : ok.get(it.path)));
    const failed = res.filter((r) => !r.ok);
    const warned = res.filter((r) => r.warning).length;
    if (done.length) {
      const freed = done.reduce((a, b) => a + b.size, 0);
      toast(
        "ok",
        `${count(done.length)} öğe ${toTrash ? "Geri Dönüşüm Kutusu'na taşındı" : "silindi"} · ${bytes(freed)}` +
          (warned ? ` (${warned} öğede Steam'e ulaşılamadı)` : ""),
      );
    }
    if (failed.length) {
      toast("error", `${count(failed.length)} öğe silinemedi: ${failed[0].error ?? "bilinmeyen hata"}`);
    }
    if (detail && done.some((d) => d.path === detail.path)) setDetail(null);
    await rescan();
    if (steam.connected) refreshSubscribed().catch(() => {});
  };

  const doExport = async (list: Item[], dest: string, mode: ExportMode) => {
    setToExport(null);
    if (info && info.exportDir !== dest) {
      api.setConfig({ ...info.config, exportDir: dest }).then(setInfo).catch(() => {});
    }
    const reqs = list
      .filter((i) => i.gmaPath)
      .map((i) => ({ gmaPath: i.gmaPath!, name: (i.workshopId && details[i.workshopId]?.title) || i.title || i.name }));
    const res = await run("Dışa aktarılıyor", () => api.exportItems(reqs, dest, mode));
    if (!res) return;
    const good = res.filter((r) => r.ok);
    const bad = res.filter((r) => !r.ok);
    if (good.length) {
      toast("ok", `${count(good.length)} öğe dışa aktarıldı`, {
        label: "Klasörde göster",
        run: () => revealItemInDir(good[0].output!),
      });
    }
    if (bad.length) toast("error", `${count(bad.length)} öğe aktarılamadı: ${bad[0].error}`);
  };

  const ctx: Ctx = {
    info,
    setInfo,
    scan,
    scanning,
    items,
    details,
    subscribed,
    steam,
    connectSteam,
    disconnectSteam,
    rescan,
    navigate: (p) => {
      setPage(p);
      setDetail(null);
    },
    openDetail: setDetail,
    askDelete: (list) => list.length && setToDelete(list),
    askExport: (list) => {
      const usable = list.filter((i) => i.gmaPath);
      if (usable.length) setToExport(usable);
      else toast("info", "Seçilenlerde dışa aktarılabilecek bir GMA yok.");
    },
    toast,
    run,
  };

  const sizes = useMemo(() => {
    const m: Partial<Record<Page, number>> = {};
    for (const s of SECTIONS) m[s.key] = items.filter((i) => i.section === s.key).reduce((a, b) => a + b.size, 0);
    return m;
  }, [items]);

  const section = SECTIONS.find((s) => s.key === page);

  return (
    <div className="flex h-full">
      <aside className="flex w-[236px] shrink-0 flex-col border-r border-line px-3 pt-5 pb-3">
        <div className="mb-5 flex items-center gap-2.5 px-2">
          <Tile color="linear-gradient(145deg, #2f9bff, #0a5fe0)" size={34}>
            <HardDrive size={18} />
          </Tile>
          <div className="leading-tight">
            <div className="text-[15px] font-semibold">GMod Cleaner</div>
            <div className="tabular text-[11.5px] text-muted">
              {scan ? `${bytes(items.reduce((a, b) => a + b.size, 0))} kullanılıyor` : scanning ? "Taranıyor…" : "—"}
            </div>
          </div>
        </div>

        <nav className="flex flex-col gap-0.5">
          {NAV.map((n) => (
            <NavButton key={n.key} item={n} active={page === n.key} size={sizes[n.key]} onClick={() => ctx.navigate(n.key)} />
          ))}
          <div className="mx-2 my-2 border-t border-line" />
          {TOOLS.map((n) => (
            <NavButton key={n.key} item={n} active={page === n.key} onClick={() => ctx.navigate(n.key)} />
          ))}
        </nav>

        <div className="mt-auto">
          <button
            onClick={() => (steam.connected ? ctx.navigate("settings") : connectSteam().then((s) => s.error && toast("error", s.error)))}
            className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-fill"
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${steam.connected ? "bg-success" : "bg-muted/60"}`} />
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-[12.5px] font-medium">
                {steam.connected ? steam.name || "Steam bağlı" : "Steam bağlı değil"}
              </span>
              <span className="block text-[11px] text-muted">{steam.connected ? "Steam'e bağlı" : "Bağlanmak için tıkla"}</span>
            </span>
          </button>
        </div>
      </aside>

      <main className="relative min-w-0 flex-1">
        {scanError ? (
          <div className="grid h-full place-items-center p-10">
            <div className="max-w-sm text-center">
              <Tile color="var(--warn)" size={52}>
                <Info size={26} />
              </Tile>
              <h2 className="mt-4 text-[19px] font-semibold">Garry's Mod bulunamadı</h2>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{scanError}</p>
              <div className="mt-5 flex justify-center gap-2">
                <Button variant="primary" onClick={() => ctx.navigate("settings")}>
                  Ayarları aç
                </Button>
                <Button icon={<RefreshCw size={14} />} onClick={rescan}>
                  Yeniden dene
                </Button>
              </div>
            </div>
            {page === "settings" && (
              <div className="absolute inset-0 bg-bg">
                <SettingsPage ctx={ctx} />
              </div>
            )}
          </div>
        ) : !scan ? (
          <div className="grid h-full place-items-center">
            <div className="flex items-center gap-3 text-[14px] text-muted">
              <Spinner /> Garry's Mod klasörleri taranıyor…
            </div>
          </div>
        ) : page === "overview" ? (
          <Overview ctx={ctx} />
        ) : section ? (
          <ItemsPage key={section.key} ctx={ctx} section={section.key} />
        ) : page === "download" ? (
          <DownloadPage ctx={ctx} />
        ) : page === "publish" ? (
          <PublishPage ctx={ctx} />
        ) : (
          <SettingsPage ctx={ctx} />
        )}

        {detail && (
          <DetailPanel
            key={detail.path}
            ctx={ctx}
            item={items.find((i) => i.path === detail.path) ?? detail}
            onClose={() => setDetail(null)}
          />
        )}
      </main>

      {toDelete && <DeleteDialog ctx={ctx} items={toDelete} onCancel={() => setToDelete(null)} onConfirm={doDelete} />}
      {toExport && <ExportDialog ctx={ctx} items={toExport} onCancel={() => setToExport(null)} onConfirm={doExport} />}

      {busy && (
        <Modal width={380}>
          <div className="flex items-center gap-3">
            <Spinner size={20} />
            <div className="text-[16px] font-semibold">{busy}</div>
          </div>
          <div className="mt-4">
            <ProgressBar value={task && task.total ? (task.index + task.fraction) / task.total : 0} />
            <div className="mt-2 flex justify-between gap-3 text-[12.5px] text-muted">
              <span className="truncate">{task?.label || "Hazırlanıyor…"}</span>
              {task && task.total > 1 && (
                <span className="tabular shrink-0">
                  {Math.min(task.index + 1, task.total)} / {task.total}
                </span>
              )}
            </div>
          </div>
        </Modal>
      )}

      <div className="pointer-events-none fixed right-5 bottom-5 z-[60] flex flex-col items-end gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="pointer-events-auto flex max-w-[440px] animate-rise items-center gap-2.5 rounded-2xl bg-surface py-2.5 pr-3 pl-3.5 text-[13px] shadow-pop"
          >
            {t.kind === "ok" ? (
              <CheckCircle2 size={18} className="shrink-0 text-success" />
            ) : t.kind === "error" ? (
              <XCircle size={18} className="shrink-0 text-danger" />
            ) : (
              <Info size={18} className="shrink-0 text-accent" />
            )}
            <span className="selectable min-w-0 leading-snug">{t.text}</span>
            {t.action && (
              <Button size="sm" variant="plain" onClick={t.action.run}>
                {t.action.label}
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function NavButton({
  item,
  active,
  size,
  onClick,
}: {
  item: (typeof NAV)[number];
  active: boolean;
  size?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`flex h-10 items-center gap-2.5 rounded-xl px-2 text-left text-[13.5px] transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
        active ? "bg-surface font-medium shadow-soft" : "hover:bg-fill/70"
      }`}
    >
      <Tile color={item.color}>{item.icon}</Tile>
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {size !== undefined && size > 0 && <span className="tabular text-[11.5px] text-muted">{bytes(size)}</span>}
    </button>
  );
}

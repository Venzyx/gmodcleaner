import { open } from "@tauri-apps/plugin-dialog";
import { AlertTriangle, CheckCircle2, FolderOpen, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { Ctx } from "../App";
import type { ExportMode, Item } from "../api";
import { Button, Modal, Segmented, Spinner, Switch, Tile } from "../ui";
import { bytes, count, displayTitle } from "../util";

export function DeleteDialog({
  ctx,
  items,
  onCancel,
  onConfirm,
}: {
  ctx: Ctx;
  items: Item[];
  onCancel: () => void;
  onConfirm: (items: Item[], toTrash: boolean, allowWithoutSteam: boolean) => void;
}) {
  const [toTrash, setToTrash] = useState(ctx.info?.config.toTrash ?? true);
  const [connecting, setConnecting] = useState(false);
  const [force, setForce] = useState(false);
  const workshop = items.filter((i) => i.kind === "workshop" && i.workshopId);
  const needsSteam = workshop.length > 0;
  const size = items.reduce((a, b) => a + b.size, 0);
  const userData = items.filter((i) => i.kind === "userdata");
  const { steam, connectSteam } = ctx;

  // Workshop öğeleri için Steam'e bağlan: abonelikten çıkılmazsa Steam yeniden indirir.
  useEffect(() => {
    if (needsSteam && !steam.connected) {
      setConnecting(true);
      connectSteam().finally(() => setConnecting(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const subCount = ctx.subscribed ? workshop.filter((i) => ctx.subscribed!.has(i.workshopId!)).length : null;
  const blocked = needsSteam && !steam.connected && !force;
  const first = items[0];
  const name = displayTitle(first, first.workshopId ? ctx.details[first.workshopId] : undefined);

  return (
    <Modal onClose={onCancel}>
      <div className="flex flex-col items-center text-center">
        <Tile color="var(--danger)" size={52}>
          <Trash2 size={24} />
        </Tile>
        <h2 className="mt-3.5 text-[18px] font-semibold">
          {items.length === 1 ? `"${name}" silinsin mi?` : `${count(items.length)} öğe silinsin mi?`}
        </h2>
        <p className="tabular mt-1 text-[13.5px] text-muted">
          {bytes(size)} yer {toTrash ? "Geri Dönüşüm Kutusu'na taşınacak" : "kalıcı olarak silinecek"}.
        </p>
      </div>

      {needsSteam && (
        <div className="mt-4 rounded-2xl bg-fill/60 px-3.5 py-3 text-[12.5px] leading-snug">
          {connecting ? (
            <div className="flex items-center gap-2.5 text-muted">
              <Spinner size={16} /> Steam'e bağlanılıyor…
            </div>
          ) : steam.connected ? (
            <div className="flex items-start gap-2.5">
              <CheckCircle2 size={17} className="mt-px shrink-0 text-success" />
              <span>
                {subCount === 0
                  ? "Bu öğelere abone değilsin; Steam yeniden indirmez."
                  : `${subCount ?? count(workshop.length)} abonelikten de çıkılacak, böylece Steam yeniden indirmeyecek.`}
              </span>
            </div>
          ) : (
            <>
              <div className="flex items-start gap-2.5">
                <AlertTriangle size={17} className="mt-px shrink-0 text-warn" />
                <span>
                  Steam'e bağlanılamadı. Abonelikten çıkılmadan silinen öğeleri Steam bir sonraki açılışta yeniden
                  indirebilir. Steam'i açıp tekrar dene.
                </span>
              </div>
              <div className="mt-2.5 flex items-center justify-between gap-3 border-t border-line pt-2.5">
                <span>Yine de sil</span>
                <Switch checked={force} onChange={setForce} label="Steam olmadan sil" />
              </div>
            </>
          )}
        </div>
      )}

      {userData.length > 0 && (
        <div className="mt-3 flex items-start gap-2.5 rounded-2xl bg-warn/12 px-3.5 py-3 text-[12.5px] leading-snug">
          <AlertTriangle size={17} className="mt-px shrink-0 text-warn" />
          <span>Seçimde kişisel verilerin var ({userData.map((u) => u.title).join(", ")}). Bunlar yeniden indirilemez.</span>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-fill/60 px-3.5 py-2.5">
        <div className="text-[13px] leading-snug">
          Geri Dönüşüm Kutusu'na taşı
          <div className="text-[11.5px] text-muted">
            {toTrash ? "Yer açmak için kutuyu boşaltman gerekir." : "Kapalıyken geri alınamaz."}
          </div>
        </div>
        <Switch checked={toTrash} onChange={setToTrash} label="Geri Dönüşüm Kutusu'na taşı" />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2.5">
        <Button size="lg" onClick={onCancel}>
          Vazgeç
        </Button>
        <Button size="lg" variant="danger" disabled={blocked || connecting} onClick={() => onConfirm(items, toTrash, force)}>
          Sil
        </Button>
      </div>
    </Modal>
  );
}

export async function pickFolder(current?: string): Promise<string | null> {
  const res = await open({ directory: true, multiple: false, defaultPath: current });
  return typeof res === "string" ? res : null;
}

export function DestinationPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2 rounded-2xl bg-fill/60 py-2 pr-2 pl-3.5">
      <FolderOpen size={16} className="shrink-0 text-muted" />
      <span className="selectable min-w-0 flex-1 truncate text-[12.5px]" title={value}>
        {value}
      </span>
      <Button size="sm" onClick={async () => onChange((await pickFolder(value)) ?? value)}>
        Değiştir
      </Button>
    </div>
  );
}

export const MODE_OPTIONS: { value: ExportMode; label: string }[] = [
  { value: "extract", label: "Klasöre çıkar" },
  { value: "gma", label: ".gma olarak kaydet" },
];

export function ExportDialog({
  ctx,
  items,
  onCancel,
  onConfirm,
}: {
  ctx: Ctx;
  items: Item[];
  onCancel: () => void;
  onConfirm: (items: Item[], dest: string, mode: ExportMode) => void;
}) {
  const [dest, setDest] = useState(ctx.info?.exportDir ?? "");
  const [mode, setMode] = useState<ExportMode>("extract");
  const size = items.reduce((a, b) => a + b.size, 0);
  return (
    <Modal onClose={onCancel} width={460}>
      <h2 className="text-[18px] font-semibold">Dışa aktar</h2>
      <p className="tabular mt-1 text-[13.5px] text-muted">
        {count(items.length)} addon · {bytes(size)}
      </p>
      <div className="mt-4 space-y-3">
        <Segmented value={mode} onChange={setMode} options={MODE_OPTIONS} className="w-full" />
        <p className="px-1 text-[12px] leading-snug text-muted">
          {mode === "extract"
            ? "Her addon, içindeki lua, model ve materyal dosyalarıyla kendi klasörüne çıkarılır."
            : "Her addon tek bir .gma dosyası olarak kopyalanır (eski biçimdekiler açılarak)."}
        </p>
        <DestinationPicker value={dest} onChange={setDest} />
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2.5">
        <Button size="lg" onClick={onCancel}>
          Vazgeç
        </Button>
        <Button size="lg" variant="primary" disabled={!dest} onClick={() => onConfirm(items, dest, mode)}>
          Dışa aktar
        </Button>
      </div>
    </Modal>
  );
}

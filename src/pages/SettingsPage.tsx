import { useState } from "react";
import type { Ctx } from "../App";
import { api } from "../api";
import { pickFolder } from "../components/Dialogs";
import { Button, Card, GroupLabel, Row, Switch } from "../ui";
import { errorText } from "../util";

export function SettingsPage({ ctx }: { ctx: Ctx }) {
  const { info, steam } = ctx;
  const [connecting, setConnecting] = useState(false);
  if (!info) return null;

  const save = async (patch: Partial<typeof info.config>, rescan = false) => {
    try {
      ctx.setInfo(await api.setConfig({ ...info.config, ...patch }));
      if (rescan) await ctx.rescan();
    } catch (e) {
      ctx.toast("error", errorText(e));
    }
  };

  const connect = async () => {
    setConnecting(true);
    const s = await ctx.connectSteam();
    setConnecting(false);
    if (s.error) ctx.toast("error", s.error);
  };

  return (
    <div className="scroll-area h-full overflow-y-auto px-7 pt-6 pb-10">
      <div className="mx-auto max-w-[760px]">
        <h1 className="text-[26px] leading-tight font-bold tracking-tight">Ayarlar</h1>

        <div className="mt-5">
          <GroupLabel>Klasörler</GroupLabel>
          <Card>
            <Row
              label="Garry's Mod klasörü"
              hint={<span className="selectable break-all">{info.gmodDir ?? info.error ?? "Bulunamadı"}</span>}
            >
              {info.config.gmodDir && (
                <Button size="sm" onClick={() => save({ gmodDir: null }, true)}>
                  Otomatik bul
                </Button>
              )}
              <Button
                size="sm"
                onClick={async () => {
                  const dir = await pickFolder(info.gmodDir ?? undefined);
                  if (dir) save({ gmodDir: dir }, true);
                }}
              >
                Değiştir
              </Button>
            </Row>
            <Row label="Dışa aktarma klasörü" hint={<span className="selectable break-all">{info.exportDir}</span>} last>
              <Button
                size="sm"
                onClick={async () => {
                  const dir = await pickFolder(info.exportDir);
                  if (dir) save({ exportDir: dir });
                }}
              >
                Değiştir
              </Button>
            </Row>
          </Card>
        </div>

        <div className="mt-5">
          <GroupLabel>Silme</GroupLabel>
          <Card>
            <Row
              label="Geri Dönüşüm Kutusu'na taşı"
              hint="Açıkken silinenler geri alınabilir, ama yer açmak için kutuyu boşaltman gerekir. Kapalıyken kalıcı olarak silinir."
              last
            >
              <Switch checked={info.config.toTrash} onChange={(v) => save({ toTrash: v })} label="Geri Dönüşüm Kutusu'na taşı" />
            </Row>
          </Card>
        </div>

        <div className="mt-5">
          <GroupLabel>Steam</GroupLabel>
          <Card>
            <Row
              label={steam.connected ? `Bağlı: ${steam.name || "Steam"}` : "Bağlı değil"}
              hint="Workshop öğesi silerken abonelikten çıkmak, addon indirmek ve yayınlamak için kullanılır. Bağlıyken Steam seni Garry's Mod oynuyor olarak gösterir."
              last
            >
              {steam.connected ? (
                <Button size="sm" onClick={ctx.disconnectSteam}>
                  Bağlantıyı kes
                </Button>
              ) : (
                <Button size="sm" variant="primary" busy={connecting} onClick={connect}>
                  Bağlan
                </Button>
              )}
            </Row>
          </Card>
          <p className="mt-2 px-4 text-[12px] leading-snug text-muted">
            Steam, abone olduğun bir addonun dosyalarını bulamazsa yeniden indirir. Bu yüzden GMod Cleaner bir Workshop öğesini silerken önce
            abonelikten çıkar.
          </p>
        </div>
      </div>
    </div>
  );
}

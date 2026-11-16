import { ChevronRight, RefreshCw, Sparkles } from "lucide-react";
import { useMemo } from "react";
import type { Ctx } from "../App";
import { Thumb } from "../components/ItemsPage";
import { Button, Card, GroupLabel, IconButton } from "../ui";
import { bytes, count, displayTitle, SECTIONS } from "../util";

export function Overview({ ctx }: { ctx: Ctx }) {
  const { items, scan } = ctx;
  const groups = useMemo(
    () =>
      SECTIONS.map((s) => {
        const list = items.filter((i) => i.section === s.key);
        return { ...s, count: list.length, size: list.reduce((a, b) => a + b.size, 0) };
      }),
    [items],
  );
  const total = groups.reduce((a, b) => a + b.size, 0);
  const biggest = useMemo(() => [...items].sort((a, b) => b.size - a.size).slice(0, 8), [items]);
  const cache = items.filter((i) => i.section === "cache");
  const cacheSize = cache.reduce((a, b) => a + b.size, 0);
  const used = scan ? scan.diskTotal - scan.diskFree : 0;

  return (
    <div className="scroll-area h-full overflow-y-auto px-7 pt-6 pb-10">
      <div className="mx-auto max-w-[860px]">
        <div className="flex items-end gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-[26px] leading-tight font-bold tracking-tight">Genel Bakış</h1>
            <p className="selectable mt-0.5 truncate text-[13px] text-muted">{scan?.gmodDir}</p>
          </div>
          <IconButton label="Yeniden tara" onClick={ctx.rescan} disabled={ctx.scanning}>
            <RefreshCw size={16} className={ctx.scanning ? "animate-spin" : ""} />
          </IconButton>
        </div>

        <Card className="mt-5 p-5">
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <div className="text-[12.5px] font-medium text-muted">Garry's Mod içerikleri</div>
              <div className="tabular mt-0.5 text-[34px] leading-none font-bold tracking-tight">{bytes(total)}</div>
            </div>
            {scan && scan.diskTotal > 0 && (
              <div className="tabular text-right text-[12.5px] text-muted">
                Diskte {bytes(scan.diskFree)} boş
                <div>
                  {bytes(used)} / {bytes(scan.diskTotal)} dolu
                </div>
              </div>
            )}
          </div>

          <div className="mt-5 flex h-4 w-full gap-[3px] overflow-hidden rounded-full bg-fill">
            {groups
              .filter((g) => g.size > 0)
              .map((g) => (
                <button
                  key={g.key}
                  title={`${g.label} · ${bytes(g.size)}`}
                  aria-label={`${g.label}: ${bytes(g.size)}`}
                  onClick={() => ctx.navigate(g.key)}
                  className="h-full min-w-[4px] transition-[filter] hover:brightness-110"
                  style={{ width: `${(g.size / (total || 1)) * 100}%`, background: g.color }}
                />
              ))}
          </div>

          <div className="mt-4 -mb-2">
            {groups.map((g, i) => (
              <button
                key={g.key}
                onClick={() => ctx.navigate(g.key)}
                className={`-mx-2 flex w-[calc(100%+16px)] items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-fill/50 ${
                  i ? "" : ""
                }`}
              >
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: g.color }} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-medium">{g.label}</span>
                  <span className="block truncate text-[12px] text-muted">{g.hint}</span>
                </span>
                <span className="tabular shrink-0 text-right">
                  <span className="block text-[14px] font-semibold">{bytes(g.size)}</span>
                  <span className="block text-[11.5px] text-muted">{count(g.count)} öğe</span>
                </span>
                <ChevronRight size={15} className="shrink-0 text-muted/50" />
              </button>
            ))}
          </div>
        </Card>

        {cacheSize > 0 && (
          <Card className="mt-4 flex items-center gap-4 p-4">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[12px] bg-teal text-white">
              <Sparkles size={21} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[14.5px] font-semibold">Hızlı temizlik</div>
              <div className="text-[12.5px] leading-snug text-muted">
                {bytes(cacheSize)} önbellek güvenle silinebilir; oyun gerektiğinde yeniden oluşturur.
              </div>
            </div>
            <Button variant="tinted" onClick={() => ctx.askDelete(cache)}>
              Önbelleği temizle
            </Button>
          </Card>
        )}

        {biggest.length > 0 && (
          <div className="mt-6">
            <GroupLabel>En çok yer kaplayanlar</GroupLabel>
            <Card className="overflow-hidden">
              {biggest.map((item, idx) => {
                const d = item.workshopId ? ctx.details[item.workshopId] : undefined;
                const sec = SECTIONS.find((s) => s.key === item.section)!;
                return (
                  <button
                    key={item.path}
                    onClick={() => ctx.openDetail(item)}
                    className="relative flex h-[58px] w-full items-center gap-3 px-3.5 text-left transition-colors hover:bg-fill/45"
                  >
                    <Thumb item={item} details={d} size={40} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium">{displayTitle(item, d)}</span>
                      <span className="block truncate text-[12px] text-muted">{sec.label}</span>
                    </span>
                    <span className="tabular shrink-0 text-[13.5px] font-semibold">{bytes(item.size)}</span>
                    <ChevronRight size={15} className="shrink-0 text-muted/50" />
                    {idx < biggest.length - 1 && <span className="absolute right-0 bottom-0 left-[66px] border-b border-line" />}
                  </button>
                );
              })}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

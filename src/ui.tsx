import { Check, Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "tinted" | "gray" | "danger" | "dangerTinted" | "plain";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-white hover:brightness-110 active:brightness-95",
  tinted: "bg-accent/12 text-accent hover:bg-accent/18 active:bg-accent/24",
  gray: "bg-fill text-ink hover:brightness-95 active:brightness-90",
  danger: "bg-danger text-white hover:brightness-110 active:brightness-95",
  dangerTinted: "bg-danger/12 text-danger hover:bg-danger/18 active:bg-danger/24",
  plain: "text-accent hover:bg-accent/10 active:bg-accent/16",
};

export function Button({
  variant = "gray",
  size = "md",
  icon,
  busy,
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
  busy?: boolean;
}) {
  const sizes = {
    sm: "h-7 gap-1.5 rounded-lg px-2.5 text-[12.5px]",
    md: "h-9 gap-2 rounded-xl px-3.5 text-[13.5px]",
    lg: "h-11 gap-2 rounded-[14px] px-5 text-[15px]",
  };
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      className={`inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition duration-150 outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:pointer-events-none disabled:opacity-40 ${sizes[size]} ${VARIANTS[variant]} ${className}`}
    >
      {busy ? <Loader2 size={15} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  danger,
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; danger?: boolean }) {
  return (
    <button
      {...rest}
      title={label}
      aria-label={label}
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted transition-colors outline-none hover:bg-fill focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-40 ${danger ? "hover:bg-danger/12 hover:text-danger" : "hover:text-ink"} ${className}`}
    >
      {children}
    </button>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${checked ? "bg-success" : "bg-fill"}`}
    >
      <span
        className={`absolute top-[2px] h-[22px] w-[22px] rounded-full bg-white shadow-thumb transition-all duration-200 ${checked ? "left-[20px]" : "left-[2px]"}`}
      />
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className = "",
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={`inline-flex h-8 items-center rounded-[10px] bg-fill p-[2px] ${className}`} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={`flex h-7 flex-1 items-center justify-center rounded-lg px-3 text-[12.5px] leading-none font-medium whitespace-nowrap transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
            o.value === value ? "bg-thumb text-ink shadow-thumb" : "text-muted hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** iOS seçim dairesi. */
export function Checkmark({ checked, className = "" }: { checked: boolean; className?: string }) {
  return (
    <span
      className={`grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border-[1.5px] transition-all duration-150 ${
        checked ? "border-accent bg-accent text-white" : "border-muted/50 text-transparent"
      } ${className}`}
    >
      <Check size={13} strokeWidth={3.2} />
    </span>
  );
}

/** iOS Ayarlar tarzı renkli simge karesi. */
export function Tile({ color, size = 28, children }: { color: string; size?: number; children: ReactNode }) {
  return (
    <span
      className="grid shrink-0 place-items-center text-white"
      style={{ background: color, width: size, height: size, borderRadius: size * 0.27 }}
    >
      {children}
    </span>
  );
}

export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`rounded-2xl bg-surface shadow-soft ${className}`}>{children}</div>;
}

export function Row({
  label,
  hint,
  children,
  last,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
  last?: boolean;
}) {
  return (
    <div className={`flex min-h-[48px] items-center gap-4 px-4 py-2.5 ${last ? "" : "border-b border-line"}`}>
      <div className="min-w-0 flex-1">
        <div className="text-[14px]">{label}</div>
        {hint && <div className="mt-0.5 text-[12px] leading-snug text-muted">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

export function GroupLabel({ children }: { children: ReactNode }) {
  return <div className="mb-1.5 px-4 text-[12px] font-medium tracking-wide text-muted uppercase">{children}</div>;
}

export function Modal({
  onClose,
  width = 420,
  children,
}: {
  onClose?: () => void;
  width?: number;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid animate-fade-in place-items-center bg-black/35 p-6 backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="scroll-area max-h-full animate-pop overflow-y-auto rounded-3xl bg-surface p-6 shadow-pop"
        style={{ width }}
      >
        {children}
      </div>
    </div>
  );
}

export function ProgressBar({ value, color = "var(--accent)" }: { value: number; color?: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-fill">
      <div
        className="h-full rounded-full transition-[width] duration-200"
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }}
      />
    </div>
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return <Loader2 size={size} className="animate-spin text-muted" />;
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`selectable h-9 w-full rounded-xl bg-fill px-3 text-[13.5px] outline-none placeholder:text-muted focus:ring-2 focus:ring-accent/50 ${props.className ?? ""}`}
    />
  );
}

export function Badge({ color = "var(--muted)", children }: { color?: string; children: ReactNode }) {
  return (
    <span
      className="inline-flex h-[18px] shrink-0 items-center rounded-md px-1.5 text-[10.5px] font-semibold tracking-wide uppercase"
      style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}
    >
      {children}
    </span>
  );
}

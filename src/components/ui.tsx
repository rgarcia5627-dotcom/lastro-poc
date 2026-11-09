import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import type { Tone } from "@/lib/labels";

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50";
const variants: Record<Variant, string> = {
  primary: "bg-ink text-white hover:bg-ink/85",
  secondary: "border border-line bg-white text-ink hover:bg-canvas",
  ghost: "text-ink hover:bg-ink/5",
  danger: "bg-danger text-white hover:bg-danger/90",
};
const sizes: Record<Size, string> = { sm: "h-8 px-3 text-sm", md: "h-10 px-4 text-sm" };

export function buttonClass(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cx(base, variants[variant], sizes[size], className);
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button className={buttonClass(variant, size, className)} {...props} />;
}

export function LinkButton({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

export function Card({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("rounded-xl border border-line bg-white", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            {title && <h2 className="text-base font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export const inputClass =
  "block w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-muted/70 focus:border-ink focus:outline-none disabled:bg-canvas disabled:text-muted";

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

const tones: Record<Tone, string> = {
  neutral: "bg-ink/5 text-ink/70",
  brand: "bg-brand-soft text-brand-strong",
  ok: "bg-ok/10 text-ok",
  warn: "bg-warn/10 text-warn",
  danger: "bg-danger/10 text-danger",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", tones[tone])}>
      {children}
    </span>
  );
}

export function StatusBadge({ map, value }: { map: Record<string, [string, Tone]>; value: string }) {
  const [label, tone] = map[value] ?? [value, "neutral" as Tone];
  return <Badge tone={tone}>{label}</Badge>;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-white px-5 py-4">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

/** `wide` keeps a 640px minimum (scrolls on phones); compact tables in half-width cards opt out. */
export function Table({ children, wide = true }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className={cx("w-full text-left text-sm", wide && "min-w-[640px]")}>{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={cx("border-b border-line px-5 py-2 text-xs font-medium text-muted", className)}>{children}</th>;
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cx("border-b border-line/70 px-5 py-3 align-middle", className)}>{children}</td>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted">{children}</p>;
}

export function Notice({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  const border: Record<Tone, string> = {
    neutral: "border-line bg-white",
    brand: "border-brand/40 bg-brand-soft",
    ok: "border-ok/30 bg-ok/5",
    warn: "border-warn/30 bg-warn/5",
    danger: "border-danger/30 bg-danger/5",
  };
  return <div className={cx("rounded-lg border px-4 py-3 text-sm", border[tone])}>{children}</div>;
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-brand-strong underline-offset-2 hover:underline">
      {children}
    </a>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-xs break-all">{children}</span>;
}

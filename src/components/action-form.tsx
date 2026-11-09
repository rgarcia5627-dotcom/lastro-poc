"use client";

import { type ReactNode, startTransition, useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/actions/shared";
import { Button, cx } from "./ui";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

function Submit({
  label,
  pendingLabel,
  variant,
  size,
  busy,
}: {
  label: string;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  busy?: boolean;
}) {
  const status = useFormStatus();
  const pending = busy ?? status.pending;
  return (
    <Button type="submit" variant={variant} size={size} disabled={pending} aria-busy={pending}>
      {pending ? (pendingLabel ?? "Enviando…") : label}
    </Button>
  );
}

export function FormMessage({ state }: { state: ActionState }) {
  if (!state) return null;
  if (state.error)
    return (
      <p role="alert" className="text-sm text-danger">
        {state.error}
      </p>
    );
  if (state.ok)
    return (
      <p role="status" className="text-sm text-ok">
        {state.ok}
      </p>
    );
  return null;
}

/** A form bound to a server action, with inline error/success feedback. */
export function ActionForm({
  action,
  children,
  submitLabel,
  pendingLabel,
  className,
  variant = "primary",
}: {
  action: Action;
  children?: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  className?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  // Submitted by hand instead of `<form action>`: React resets a form after its action runs,
  // which would wipe every field when the server answers with a validation error.
  return (
    <form
      className={cx("space-y-4", className)}
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
    >
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <Submit label={submitLabel} pendingLabel={pendingLabel} variant={variant} busy={pending} />
        <FormMessage state={state} />
      </div>
    </form>
  );
}

/**
 * A single button bound to a server action. With `confirm`, the first click asks
 * for an inline confirmation (used for on-chain and irreversible actions).
 */
export function ActionButton({
  action,
  label,
  pendingLabel,
  confirm,
  variant = "secondary",
  size = "sm",
  hidden,
}: {
  action: Action;
  label: string;
  pendingLabel?: string;
  confirm?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  hidden?: Record<string, string>;
}) {
  const [state, formAction] = useActionState(action, undefined);
  const [asking, setAsking] = useState(false);
  return (
    <form action={formAction} className="inline-flex flex-wrap items-center gap-2" onSubmit={() => setAsking(false)}>
      {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {confirm && !asking ? (
        <Button type="button" variant={variant} size={size} onClick={() => setAsking(true)}>
          {label}
        </Button>
      ) : (
        <>
          {confirm && <span className="text-sm text-muted">{confirm}</span>}
          <Submit label={confirm ? "Confirmar" : label} pendingLabel={pendingLabel} variant={variant} size={size} />
          {confirm && (
            <Button type="button" variant="ghost" size={size} onClick={() => setAsking(false)}>
              Cancelar
            </Button>
          )}
        </>
      )}
      <FormMessage state={state} />
    </form>
  );
}

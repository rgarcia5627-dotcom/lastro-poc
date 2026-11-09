import type { ReactNode } from "react";
import type { ScenarioRow } from "@/lib/db/schema";
import { formatBRL, formatDateTime, plainDecimal } from "@/lib/format";
import { AMORTIZATIONS, amortizationLabel, changedFields, type ScenarioField, subscriptionAmount } from "@/lib/proposals";
import { Badge, cx, Field, inputClass } from "./ui";

type Defaults = Partial<
  Pick<ScenarioRow, "ticket" | "remuneration" | "termMonths" | "graceMonths" | "amortization" | "discount" | "fees" | "subordination" | "guarantees">
>;

/**
 * Inputs for one scenario. With `index`, names get a suffix (`ticket_0`) so a form can hold
 * several scenarios; without it they are plain (`ticket`), for the institution's single version.
 */
export function ScenarioInputs({ index, defaults, withNote = false }: { index?: number; defaults?: Defaults; withNote?: boolean }) {
  const name = (k: string) => (index === undefined ? k : `${k}_${index}`);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Ticket (valor de face, R$)">
        <input
          name={name("ticket")}
          inputMode="decimal"
          defaultValue={defaults?.ticket ? plainDecimal(defaults.ticket) : ""}
          className={inputClass}
          placeholder="5000000"
        />
      </Field>
      <Field label="Remuneração">
        <input name={name("remuneration")} defaultValue={defaults?.remuneration ?? ""} className={inputClass} placeholder="CDI + 4,5% a.a." />
      </Field>
      <Field label="Prazo (meses)">
        <input name={name("termMonths")} inputMode="numeric" defaultValue={defaults?.termMonths ?? ""} className={inputClass} placeholder="36" />
      </Field>
      <Field label="Carência (meses)">
        <input name={name("graceMonths")} inputMode="numeric" defaultValue={defaults?.graceMonths ?? 0} className={inputClass} />
      </Field>
      <Field label="Amortização">
        <select name={name("amortization")} defaultValue={defaults?.amortization ?? "sac"} className={inputClass}>
          {AMORTIZATIONS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Deságio (%)">
        <input
          name={name("discount")}
          inputMode="decimal"
          defaultValue={defaults?.discount ? plainDecimal(defaults.discount) : "0"}
          className={inputClass}
        />
      </Field>
      <Field label="Fees">
        <input name={name("fees")} defaultValue={defaults?.fees ?? ""} className={inputClass} placeholder="Estruturação 1,5% paga pelo cedente" />
      </Field>
      <Field label="Subordinação">
        <input
          name={name("subordination")}
          defaultValue={defaults?.subordination ?? ""}
          className={inputClass}
          placeholder="Subordinada de 20% retida pelo cedente"
        />
      </Field>
      <Field label="Colateral / garantias">
        <input
          name={name("guarantees")}
          defaultValue={defaults?.guarantees ?? ""}
          className={inputClass}
          placeholder="Cessão fiduciária de recebíveis (120%)"
        />
      </Field>
      {withNote && (
        <Field label="Comentário" className="sm:col-span-2">
          <textarea name={name("note")} rows={2} className={inputClass} placeholder="O que mudou e por quê" />
        </Field>
      )}
    </div>
  );
}

function Row({ label, changed, children }: { label: string; changed?: boolean; children: ReactNode }) {
  return (
    <div className={cx("flex justify-between gap-4 rounded px-1.5 py-1", changed && "bg-warn/10")}>
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium">
        {children}
        {changed && <span className="ml-1.5 text-xs font-normal text-warn">alterado</span>}
      </dd>
    </div>
  );
}

/** Read-only scenario. `changed` highlights the fields edited from the scenario it was based on. */
export function ScenarioCard({
  scenario,
  changed,
  tag,
  children,
  className,
}: {
  scenario: ScenarioRow;
  changed?: Set<ScenarioField>;
  tag?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const c = (f: ScenarioField) => Boolean(changed?.has(f));
  return (
    <div className={cx("rounded-lg border border-line bg-white p-4", className)}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{scenario.label}</h3>
        {tag ?? <Badge tone={scenario.author === "institution" ? "brand" : "neutral"}>{scenario.author === "institution" ? "Instituição" : "Lastro"}</Badge>}
      </div>
      <dl className="space-y-0.5 text-sm">
        <Row label="Ticket (face)" changed={c("ticket")}>
          <span className="tabular-nums">{formatBRL(scenario.ticket)}</span>
        </Row>
        <Row label="Deságio" changed={c("discount")}>
          <span className="tabular-nums">
            {Number(scenario.discount) > 0
              ? `${plainDecimal(scenario.discount).replace(".", ",")}% · paga ${formatBRL(subscriptionAmount(scenario.ticket, scenario.discount))}`
              : "sem deságio"}
          </span>
        </Row>
        <Row label="Remuneração" changed={c("remuneration")}>
          {scenario.remuneration}
        </Row>
        <Row label="Prazo" changed={c("termMonths")}>
          {scenario.termMonths} meses
        </Row>
        <Row label="Carência" changed={c("graceMonths")}>
          {scenario.graceMonths ? `${scenario.graceMonths} meses` : "sem carência"}
        </Row>
        <Row label="Amortização" changed={c("amortization")}>
          {amortizationLabel(scenario.amortization)}
        </Row>
        <Row label="Fees" changed={c("fees")}>
          {scenario.fees ?? "—"}
        </Row>
        <Row label="Subordinação" changed={c("subordination")}>
          {scenario.subordination ?? "—"}
        </Row>
        <Row label="Colateral" changed={c("guarantees")}>
          {scenario.guarantees ?? "—"}
        </Row>
      </dl>
      {scenario.note && <p className="mt-3 border-t border-line pt-2 text-sm text-muted whitespace-pre-line">“{scenario.note}”</p>}
      {children}
    </div>
  );
}

/** Scenarios grouped by round (newest first), each with the fields changed from its base. */
export function roundsOf(scenarios: ScenarioRow[]) {
  const byId = new Map(scenarios.map((s) => [s.id, s]));
  const rounds = new Map<number, { scenario: ScenarioRow; changed?: Set<ScenarioField> }[]>();
  for (const scenario of scenarios) {
    const base = scenario.basedOnId ? byId.get(scenario.basedOnId) : undefined;
    const list = rounds.get(scenario.round) ?? [];
    list.push({ scenario, changed: base ? changedFields(base, scenario) : undefined });
    rounds.set(scenario.round, list);
  }
  return [...rounds.entries()]
    .sort(([a], [b]) => b - a)
    .map(([round, items]) => ({ round, author: items[0]?.scenario.author ?? "lastro", at: items[0]?.scenario.createdAt, items }));
}

/** The negotiation so far: one block per round. */
export function ProposalRounds({ scenarios, skipRound, agreedId }: { scenarios: ScenarioRow[]; skipRound?: number; agreedId?: string | null }) {
  const rounds = roundsOf(scenarios).filter((r) => r.round !== skipRound);
  if (!rounds.length) return null;
  return (
    <ol className="space-y-5">
      {rounds.map((r) => (
        <li key={r.round}>
          <div className="mb-2 text-xs font-medium text-muted">
            Rodada {r.round} · {r.author === "institution" ? "versão da instituição" : "cenários da Lastro"} · {formatDateTime(r.at ?? null)}
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {r.items.map(({ scenario, changed }) => (
              <ScenarioCard
                key={scenario.id}
                scenario={scenario}
                changed={changed}
                tag={scenario.id === agreedId ? <Badge tone="ok">Acordado</Badge> : undefined}
              />
            ))}
          </div>
        </li>
      ))}
    </ol>
  );
}

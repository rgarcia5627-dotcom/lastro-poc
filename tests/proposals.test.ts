import { describe, expect, it } from "vitest";
import {
  addMonths,
  changedFields,
  parseScenarios,
  sameStructure,
  structureSummary,
  subscriptionAmount,
  ticketToQuantity,
} from "@/lib/proposals";

const slot = (i: number, over: Record<string, string> = {}) => {
  const base = {
    ticket: "5000000",
    remuneration: "CDI + 4,5% a.a.",
    termMonths: "36",
    graceMonths: "6",
    amortization: "sac",
    discount: "2",
    subordination: "Subordinada de 20% retida pelo cedente",
    guarantees: "Cessão fiduciária de recebíveis (120%)",
    ...over,
  };
  return Object.fromEntries(Object.entries(base).map(([k, v]) => [`${k}_${i}`, v]));
};

const structure = {
  ticket: "5000000.00",
  remuneration: "CDI + 4,5% a.a.",
  termMonths: 36,
  graceMonths: 6,
  amortization: "sac" as const,
  discount: "2.00",
  fees: "Estruturação 1,5% paga pelo cedente",
  subordination: "Subordinada de 20% retida pelo cedente",
  guarantees: "Cessão fiduciária de recebíveis (120%)",
};

describe("parseScenarios — Lastro's scenarios for one round", () => {
  it("takes the filled slots and skips the empty ones", () => {
    const parsed = parseScenarios({ ...slot(0), ...slot(2, { termMonths: "24", graceMonths: "0", amortization: "bullet" }) });
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed.scenarios).toHaveLength(2);
    expect(parsed.scenarios[0]).toMatchObject({
      ticket: "5000000.00",
      termMonths: 36,
      graceMonths: 6,
      amortization: "sac",
      discount: "2.00",
      subordination: "Subordinada de 20% retida pelo cedente",
      fees: null,
    });
    expect(parsed.scenarios[1]).toMatchObject({ termMonths: 24, amortization: "bullet" });
  });

  it("names the scenario that is wrong", () => {
    expect(parseScenarios({ ...slot(0), ...slot(1, { ticket: "-1" }) })).toEqual({
      error: expect.stringMatching(/^Cenário B: Ticket/),
    });
  });

  it("defaults an empty discount to zero and refuses one of 100% or more", () => {
    const parsed = parseScenarios(slot(0, { discount: "" }));
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed.scenarios[0]?.discount).toBe("0.00");
    expect(parseScenarios(slot(0, { discount: "100" }))).toEqual({ error: expect.stringMatching(/^Cenário A: Deságio/) });
  });

  it("refuses a grace period as long as the term, and an empty form", () => {
    expect(parseScenarios(slot(0, { graceMonths: "36" }))).toEqual({ error: "Cenário A: A carência deve ser menor que o prazo" });
    expect(parseScenarios({})).toEqual({ error: "Preencha pelo menos um cenário." });
  });
});

describe("changedFields — what the institution edited", () => {
  it("flags exactly the edited fields", () => {
    const edited = { ...structure, remuneration: "CDI + 5,0% a.a.", graceMonths: 3, discount: "2.5", subordination: "Subordinada de 25%" };
    expect([...changedFields(structure, edited)].sort()).toEqual(["discount", "graceMonths", "remuneration", "subordination"]);
  });

  it("ignores formatting: ticket scale, spacing and case in text", () => {
    const same = { ...structure, ticket: "5000000", discount: "2", remuneration: "  cdi +  4,5% A.A. " };
    expect(changedFields(structure, same).size).toBe(0);
  });

  it("sameStructure compares the series terms, not the ticket", () => {
    expect(sameStructure(structure, { ...structure, ticket: "1000000.00" } as never)).toBe(true);
    expect(sameStructure(structure, { ...structure, termMonths: 48 })).toBe(false);
    expect(sameStructure(structure, { ...structure, guarantees: null })).toBe(false);
    expect(sameStructure(structure, { ...structure, discount: "3.00" })).toBe(false); // the price is part of the series terms
  });
});

describe("closing arithmetic", () => {
  it("charges the face value less the discount, to the centavo", () => {
    expect(subscriptionAmount("5000000.00", "2.00")).toBe("4900000.00");
    expect(subscriptionAmount("1234.57", "0.00")).toBe("1234.57");
    expect(subscriptionAmount("1000.01", "1.50")).toBe("985.01"); // 985.00985 → half up
  });

  it("turns the agreed ticket into tokens at the issue PU, never above the ticket", () => {
    expect(ticketToQuantity("5000000.00", "1000.00000000")).toBe("5000.0000000");
    expect(ticketToQuantity("1000.00", "3.00000000")).toBe("333.3333333"); // rounded down
    expect(() => ticketToQuantity("1000.00", "0")).toThrow();
  });

  it("derives the maturity from the issue date and the term, clamping the day", () => {
    expect(addMonths("2026-11-04", 36)).toBe("2029-11-04");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2027-12-15", 1)).toBe("2028-01-15");
  });

  it("describes the structure written to the asset", () => {
    expect(structureSummary({ amortization: "sac", termMonths: 36, graceMonths: 3 })).toBe("SAC mensal · 36 meses · carência de 3 meses");
    expect(structureSummary({ amortization: "bullet", termMonths: 24, graceMonths: 0 })).toBe("Bullet (no vencimento) · 24 meses");
    expect(structureSummary({ amortization: "sac", termMonths: 36, graceMonths: 3 }, "en")).toBe("Monthly, constant principal · 36 months · 3-month grace period");
  });
});

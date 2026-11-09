import { createHash } from "node:crypto";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { E2E_BASE_URL } from "../../playwright.config";

/**
 * The whole POC, as real users, in both profiles (Lastro serves institutions only):
 *   Admin (Lastro)  – invite → passkey → KYB → asset (draft) → structuring proposal (scenarios) →
 *                     confirms with the borrower and closes → tokenize → delivery → PU →
 *                     payment (paid off-chain, registered on-chain) → freeze/unfreeze
 *   Institution     – signup (institution + professional-investor declaration) → PRF-derived
 *                     Stellar wallet (0 XLM) → edits a scenario and sends it back → accepts
 *                     (trustline) → holds tokens → payments + on-chain record → login
 *   Anyone          – public payment history, verified in the browser against Horizon
 * Every on-chain step hits Stellar testnet and is also checked against Horizon.
 */

const SHOTS = process.env.E2E_SCREENSHOTS ?? "scf-submission/screenshots";
const HORIZON = "https://horizon-testnet.stellar.org";
const CODE = `LCR${Date.now().toString(36).slice(-5).toUpperCase()}`;
const ADMIN = { name: "Ana Lastro", email: "ana@lastro.test" };
const INST = {
  org: "Aurora Gestora de Recursos Ltda.",
  taxId: "12.345.678/0001-90",
  name: "Bruno Almeida",
  email: `bruno+${Date.now()}@aurora-gestora.test`,
};
const ASSET_NAME = "CR Kalata 2026";
const SETTLEMENT_REF = "TED 000123 do agente fiduciário";
const CLIENT_OK = "Aprovado pelo CFO da Kalata por e-mail em 05/11/2026";

let admin: Page;
let inst: Page;
let instAddress = "";
let assetUrl = "";
let proposalUrl = "";
let recordHash = "";

async function shot(page: Page, name: string) {
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

/** Screenshot of one card (a <section> titled `title`), for close-ups in the walkthrough. */
async function shotCard(page: Page, title: string, name: string) {
  await page.waitForLoadState("networkidle");
  await page.locator("section", { has: page.getByRole("heading", { name: title, exact: true }) }).screenshot({ path: `${SHOTS}/${name}.png` });
}

/** A platform authenticator with PRF — the same capability iCloud Keychain / Google Password Manager expose. */
async function openWithPasskeys(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    baseURL: E2E_BASE_URL,
    viewport: { width: 1280, height: 860 },
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable", { enableUI: false });
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      ctap2Version: "ctap2_1",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
      hasPrf: true,
    },
  } as Parameters<typeof cdp.send<"WebAuthn.addVirtualAuthenticator">>[1]);
  return page;
}

async function horizonAccount(address: string) {
  const res = await fetch(`${HORIZON}/accounts/${address}`);
  expect(res.ok, `account ${address} should exist on testnet`).toBe(true);
  return (await res.json()) as {
    balances: { asset_type: string; asset_code?: string; balance: string; is_authorized?: boolean }[];
    num_sponsored: number;
  };
}

/** Clicks a two-step ActionButton (label → "Confirmar") inside `scope`. */
async function confirmAction(scope: ReturnType<Page["locator"]> | Page, label: string) {
  await scope.getByRole("button", { name: label, exact: true }).click();
  await scope.getByRole("button", { name: "Confirmar" }).click();
}

test.describe.serial("Lastro POC — admin e instituição", () => {
  test.beforeAll(async ({ browser }) => {
    admin = await openWithPasskeys(browser);
    inst = await openWithPasskeys(browser);
  });

  test("admin aceita o convite e cria a passkey", async () => {
    const invite = process.env.E2E_ADMIN_INVITE;
    expect(invite, "global setup creates the invite").toBeTruthy();
    await admin.goto(`/convite/${invite}`);
    await expect(admin.getByRole("heading", { name: "Acesso de administrador" })).toBeVisible();
    await admin.getByLabel("Nome completo").fill(ADMIN.name);
    await expect(admin.getByLabel("E-mail")).toHaveValue(ADMIN.email);
    await shot(admin, "01-admin-invite");
    await admin.getByRole("button", { name: "Criar acesso de administrador" }).click();
    await expect(admin).toHaveURL(/\/admin$/);
    await expect(admin.getByRole("heading", { name: "Visão geral" })).toBeVisible();
    await shot(admin, "02-admin-overview-empty");
  });

  test("instituição se cadastra com passkey e ganha uma carteira Stellar sem XLM", async () => {
    await inst.goto("/cadastro");
    await expect(inst.getByRole("heading", { name: "Cadastro institucional" })).toBeVisible();
    await inst.getByLabel("Instituição (razão social)").fill(INST.org);
    await inst.getByLabel("CNPJ ou registro no exterior").fill(INST.taxId);
    await inst.getByLabel("Tipo de instituição").selectOption("gestora");
    await inst.getByLabel("Nome completo do representante").fill(INST.name);
    await inst.getByLabel("E-mail corporativo").fill(INST.email);
    await inst.getByLabel(/é investidor profissional/).check();
    await shot(inst, "03-institution-signup");
    await inst.getByRole("button", { name: "Criar conta com passkey" }).click();
    await expect(inst).toHaveURL(/\/app$/);
    await expect(inst.getByText("Carteira Stellar da instituição")).toBeVisible();
    await expect(inst.getByRole("heading", { name: INST.org })).toBeVisible();
    await expect(inst.getByText(/cadastro da instituição está em análise \(KYB\)/)).toBeVisible();

    instAddress = (await inst.locator("span.font-mono").first().innerText()).trim();
    expect(instAddress).toMatch(/^G[A-Z2-7]{55}$/);
    const account = await horizonAccount(instAddress);
    expect(account.balances.find((b) => b.asset_type === "native")?.balance).toBe("0.0000000");
    await shot(inst, "04-institution-wallet-created");
  });

  test("admin aprova o KYB da instituição", async () => {
    await admin.goto("/admin/instituicoes");
    const row = admin.locator("tr", { hasText: INST.org });
    await expect(row).toContainText(INST.taxId);
    await expect(row).toContainText("Gestora de recursos");
    await expect(row).toContainText("Declarou-se investidor profissional");
    await row.getByRole("button", { name: "Aprovar" }).click();
    await expect(row.getByText("KYB aprovado")).toBeVisible();
    await shot(admin, "05-admin-institutions-kyb");
  });

  test("admin cadastra a operação como ativo em rascunho", async () => {
    await admin.goto("/admin/ativos/novo");
    const f = (name: string) => admin.locator(`main [name="${name}"]`);
    await f("name").fill(ASSET_NAME);
    await f("kind").selectOption("CR");
    await f("issuerName").fill("Securitizadora Exemplo S.A. — Patrimônio Separado 01");
    await f("code").fill(CODE);
    await f("tokenSupply").fill("15000");
    await f("totalVolume").fill("15000000");
    await f("unitPrice").fill("1000");
    await f("remuneration").fill("A definir com a instituição");
    await f("paymentFrequency").fill("Mensal");
    await f("issueDate").fill("2026-11-04");
    await f("maturityDate").fill("2029-11-04");
    await f("documentsUrl").fill("https://www.pirespartners.com.br/lastro");
    await f("description").fill("Crédito corporativo da Kalata estruturado via securitizadora, patrimônio separado e agente fiduciário.");
    await shot(admin, "06-admin-asset-form");
    await admin.getByRole("button", { name: "Salvar rascunho" }).click();
    await expect(admin).toHaveURL(/\/admin\/ativos\/[0-9a-f-]{36}$/);
    await expect(admin.getByText("Rascunho", { exact: true })).toBeVisible();
    await expect(admin.getByText(/Em estruturação/)).toBeVisible();
    assetUrl = admin.url();
  });

  test("admin propõe dois cenários de estrutura à instituição", async () => {
    await admin.getByRole("link", { name: "Nova proposta" }).first().click();
    await expect(admin).toHaveURL(/\/admin\/propostas\/nova\?ativo=/);
    const f = (name: string) => admin.locator(`main [name="${name}"]`);
    await expect(f("assetId")).toHaveValue(assetUrl.split("/").pop() ?? "");
    await f("userId").selectOption({ label: `${INST.org} — ${INST.name}` });
    // One field at a time: parallel fills race for focus and type into the wrong input.
    const scenario = async (i: number, v: Record<string, string>) => {
      for (const [k, value] of Object.entries(v)) {
        if (k === "amortization") await f(`${k}_${i}`).selectOption(value);
        else await f(`${k}_${i}`).fill(value);
      }
    };
    await scenario(0, {
      ticket: "5000000",
      remuneration: "CDI + 4,5% a.a.",
      termMonths: "36",
      graceMonths: "6",
      amortization: "sac",
      discount: "2",
      fees: "Estruturação 1,5% paga pelo cedente",
      subordination: "Subordinada de 20% retida pelo cedente",
      guarantees: "Cessão fiduciária de recebíveis (120%)",
    });
    await scenario(1, {
      ticket: "5000000",
      remuneration: "CDI + 3,9% a.a.",
      termMonths: "24",
      graceMonths: "0",
      amortization: "bullet",
      discount: "0",
      fees: "Estruturação 1,5% paga pelo cedente",
      subordination: "Subordinada de 30% retida pelo cedente",
      guarantees: "Cessão fiduciária (150%) + aval dos sócios",
    });
    await shot(admin, "07-admin-proposal-new");
    await admin.getByRole("button", { name: "Enviar cenários à instituição" }).click();
    await expect(admin).toHaveURL(/\/admin\/propostas\/[0-9a-f-]{36}$/);
    await expect(admin.getByText("Com a instituição", { exact: true })).toBeVisible();
    proposalUrl = admin.url();
  });

  test("instituição escolhe o cenário A, edita a taxa e a carência e devolve", async () => {
    await inst.goto("/app/propostas");
    await inst.getByText(ASSET_NAME).click();
    await expect(inst.getByRole("heading", { name: /Cenários da Lastro · rodada 1/ })).toBeVisible();
    const a = inst.getByRole("region", { name: "Cenário A" });
    await expect(a.locator('[name="remuneration"]')).toHaveValue("CDI + 4,5% a.a.");
    await expect(a.locator('[name="discount"]')).toHaveValue("2");
    await expect(a.locator('[name="subordination"]')).toHaveValue("Subordinada de 20% retida pelo cedente");
    await a.locator('[name="remuneration"]').fill("CDI + 5,0% a.a.");
    await a.locator('[name="graceMonths"]').fill("3");
    await a.locator('[name="note"]').fill("Fechamos o cenário A com spread de 5,0% e carência de 3 meses, pela concentração no devedor.");
    await shot(inst, "08-institution-proposal-scenarios");
    await a.getByRole("button", { name: "Enviar este cenário à Lastro" }).click();
    await expect(inst.getByText("Sua versão está com a Lastro.", { exact: false })).toBeVisible();
    await expect(inst.getByText("Com a Lastro", { exact: true })).toBeVisible();
  });

  test("admin vê o que mudou, confirma com o cliente e fecha", async () => {
    await admin.goto(proposalUrl);
    const version = admin.locator("section", { has: admin.getByRole("heading", { name: "Versão da instituição", exact: true }) });
    await expect(version).toContainText("CDI + 5,0% a.a.");
    await expect(version.getByText("alterado")).toHaveCount(2); // remuneration + grace
    await shot(admin, "09-admin-proposal-counter");
    await admin.locator('main [name="clientConfirmation"]').fill(CLIENT_OK);
    await admin.getByRole("button", { name: "Fechar proposta" }).click();
    await expect(admin.getByText("Fechada", { exact: true })).toBeVisible();
    const closing = admin.locator("section", { has: admin.getByRole("heading", { name: "Fechamento", exact: true }) });
    await expect(closing).toContainText(CLIENT_OK);
    await expect(closing).toContainText(`5.000 ${CODE} · R$ 5.000.000,00`);
    await expect(closing).toContainText("R$ 4.900.000,00 · deságio de 2%"); // what the institution pays, off-chain
    await expect(closing).toContainText("Tokenize o ativo para entregar.");
    await shot(admin, "10-admin-proposal-closed");
  });

  test("admin tokeniza na Stellar a operação com a estrutura acordada", async () => {
    await admin.goto(assetUrl);
    await expect(admin.getByText(/CDI \+ 5,0% a\.a\./).first()).toBeVisible(); // agreed terms written to the asset
    await expect(admin.locator('main [name="paymentFrequency"]')).toHaveValue("SAC mensal · 36 meses · carência de 3 meses");
    await confirmAction(admin, "Tokenizar");
    await expect(admin.getByText("Tokenizado", { exact: true })).toBeVisible();
    await expect(admin.getByText("Emitido (on-chain)")).toBeVisible();
    await expect(admin.getByText("Em tesouraria").locator("..")).toContainText("15.000");
    await shot(admin, "11-admin-asset-tokenized");
  });

  test("admin cria a transferência a partir do compromisso fechado", async () => {
    await admin.goto("/admin/transferencias");
    const commitments = admin.locator("section", { has: admin.getByRole("heading", { name: "Compromissos fechados", exact: true }) });
    const row = commitments.locator("tr", { hasText: INST.org });
    await expect(row).toContainText("5.000");
    await row.getByRole("button", { name: "Criar transferência" }).click();
    await expect(commitments.getByText("Nenhum compromisso a entregar.")).toBeVisible();
    const history = admin.locator("section", { has: admin.getByRole("heading", { name: "Histórico", exact: true }) });
    await expect(history.locator("tr", { hasText: INST.org }).getByText("Aguardando aceite")).toBeVisible();
    await shot(admin, "12-admin-transfer-created");
  });

  test("instituição aceita com a passkey (cria a trustline)", async () => {
    await inst.goto("/app");
    await expect(inst.getByRole("heading", { name: "Aguardando seu aceite" })).toBeVisible();
    await shot(inst, "13-institution-pending-accept");
    await inst.getByRole("button", { name: "Aceitar" }).click();
    await expect(inst.getByText("Aceito — aguardando envio")).toBeVisible();
    const account = await horizonAccount(instAddress);
    const line = account.balances.find((b) => b.asset_code === CODE);
    expect(line, "trustline exists on-chain").toBeTruthy();
    expect(line?.is_authorized).toBe(false); // AUTH_REQUIRED: Lastro authorizes on transfer
    await shot(inst, "14-institution-accepted");
  });

  test("admin envia os tokens da tesouraria", async () => {
    await admin.goto("/admin");
    const ready = admin.locator("li", { hasText: `5.000 ${CODE}` });
    await expect(ready).toBeVisible();
    await shot(admin, "15-admin-ready-to-transfer");
    await confirmAction(ready, "Transferir");
    await expect(ready).toHaveCount(0); // leaves "ready" once the transfer lands on-chain

    const account = await horizonAccount(instAddress);
    const line = account.balances.find((b) => b.asset_code === CODE);
    expect(line?.balance).toBe("5000.0000000");
    expect(line?.is_authorized).toBe(true);
    await admin.goto("/admin/transferencias");
    await expect(admin.locator("tr", { hasText: INST.org }).getByText("Transferido")).toBeVisible();
    await shot(admin, "16-admin-transferred");
  });

  test("instituição vê os tokens e o valor da posição", async () => {
    await inst.goto("/app");
    const row = inst.locator("tr", { hasText: ASSET_NAME });
    await expect(row).toContainText("5.000");
    await expect(row).toContainText("R$ 5.000.000,00");
    await shot(inst, "17-institution-holdings");
  });

  test("admin atualiza o PU, agenda o pagamento e registra na Stellar o pagamento feito off-chain", async () => {
    await admin.goto(assetUrl);
    await admin.locator('main [name="price"]').fill("1012.34");
    await admin.getByRole("button", { name: "Registrar PU" }).click();
    await expect(admin.getByText("PU registrado.")).toBeVisible();

    const paymentForm = admin.locator("form", { has: admin.locator('[name="amountPerToken"]') });
    await paymentForm.locator('[name="dueDate"]').fill("2026-12-04");
    await paymentForm.locator('[name="kind"]').selectOption("juros");
    await paymentForm.locator('[name="amountPerToken"]').fill("12.3456");
    await paymentForm.getByRole("button", { name: "Agendar pagamento" }).click();
    await expect(admin.getByText("Pagamento agendado.")).toBeVisible();

    const paymentRow = () => admin.locator("tr", { hasText: "04/12/2026" });
    await expect(paymentRow().getByText("Previsto", { exact: true })).toBeVisible();

    // Record date: the holder list is closed from on-chain balances; it is what the paying agent pays.
    await confirmAction(paymentRow(), "Fechar lista");
    await expect(paymentRow().getByText("Lista fechada", { exact: true })).toBeVisible();
    await expect(paymentRow()).toContainText("R$ 61.728,00");
    const csvHref = (await paymentRow().getByRole("link", { name: "lista CSV" }).getAttribute("href")) ?? "";
    const csv = await (await admin.request.get(csvHref)).text();
    expect(csv).toContain(`${INST.org};${INST.taxId};${instAddress};5000.0000000;61728.00`);

    // The cash is paid off-chain by the paying agent; Lastro then registers the settlement on Stellar.
    const register = admin.locator("form", { has: admin.locator('[name="settlementRef"]') });
    await expect(register.locator('[name="paymentId"]')).toContainText("04/12/2026");
    await register.locator('[name="settledOn"]').fill("2026-12-04");
    await register.locator('[name="settlementRef"]').fill(SETTLEMENT_REF);
    await shotCard(admin, "Pagamentos", "18-admin-payment-register");
    await register.getByRole("button", { name: "Registrar na Stellar" }).click();
    await expect(paymentRow().getByText("Pago", { exact: true })).toBeVisible();
    await expect(paymentRow()).toContainText("R$ 61.728,00");

    // The record served by the app hashes to the memo of the registry tx and to the issuer's data entry.
    const txHref = await paymentRow().getByRole("link", { name: /^tx/ }).getAttribute("href");
    const txHash = txHref?.split("/tx/")[1] ?? "";
    expect(txHash).toMatch(/^[0-9a-f]{64}$/);
    const recordHref = (await paymentRow().getByRole("link", { name: "JSON" }).getAttribute("href")) ?? "";
    const res = await admin.request.get(recordHref);
    expect(res.ok()).toBe(true);
    const body = await res.text();
    recordHash = createHash("sha256").update(body).digest("hex");
    expect(res.headers()["x-record-sha256"]).toBe(recordHash);
    const record = JSON.parse(body);
    expect(record.settlement).toEqual({ date: "2026-12-04", reference: SETTLEMENT_REF });
    expect(record.snapshot.holders).toEqual([{ address: instAddress, quantity: "5000.0000000", amount: "61728.00" }]);
    expect(record.total).toBe("61728.00");

    const tx = (await (await fetch(`${HORIZON}/transactions/${txHash}`)).json()) as { memo_type: string; memo: string };
    expect(tx.memo_type).toBe("hash");
    expect(Buffer.from(tx.memo, "base64").toString("hex")).toBe(recordHash);
    const issuer = (await (await fetch(`${HORIZON}/accounts/${record.asset.issuer}`)).json()) as { data: Record<string, string> };
    expect(Buffer.from(issuer.data[`lastro:pay:${CODE}`] ?? "", "base64").toString("hex")).toBe(recordHash);
    await shotCard(admin, "Pagamentos", "19-admin-payment-paid");
  });

  test("admin congela e reautoriza o detentor", async () => {
    // The holder row is the one showing the wallet (the proposal and transfer tables name the institution too).
    const short = `${instAddress.slice(0, 4)}…${instAddress.slice(-4)}`;
    const holder = () => admin.locator("tr", { hasText: short });
    await confirmAction(holder(), "Congelar");
    await expect(admin.getByText("Detentor congelado.")).toBeVisible();
    await expect(holder().getByText("Não autorizado")).toBeVisible();
    let line = (await horizonAccount(instAddress)).balances.find((b) => b.asset_code === CODE);
    expect(line?.is_authorized).toBe(false);
    await shot(admin, "20-admin-holder-frozen");

    await confirmAction(holder(), "Autorizar");
    await expect(admin.getByText("Detentor descongelado.")).toBeVisible();
    line = (await horizonAccount(instAddress)).balances.find((b) => b.asset_code === CODE);
    expect(line?.is_authorized).toBe(true);
  });

  test("qualquer pessoa confere o histórico público no navegador, sem login", async ({ browser }) => {
    const context = await browser.newContext({ baseURL: E2E_BASE_URL, viewport: { width: 1280, height: 860 }, locale: "en-US" });
    const visitor = await context.newPage();
    await visitor.goto(`/historico/${CODE}?lang=en`);
    await expect(visitor.getByRole("heading", { name: new RegExp(ASSET_NAME) })).toBeVisible();
    await expect(visitor.getByText("✓ authorization required, revocable, clawback")).toBeVisible();
    await expect(visitor.getByText("Monthly, constant principal · 36 months · 3-month grace period")).toBeVisible(); // the agreed structure
    await expect(visitor.getByText("Subordinada de 20% retida pelo cedente")).toBeVisible();
    await expect(visitor.getByText("Authorized wallets").locator("..")).toContainText("1");
    const row = visitor.locator("tr", { hasText: "2026-12-04" });
    await expect(row).toContainText("R$61,728.00");
    await expect(row).toContainText(SETTLEMENT_REF);
    await row.getByRole("button", { name: "Verify" }).click();
    await expect(row.getByText("✓ transaction memo: matches")).toBeVisible();
    await expect(row.getByText("✓ issuer data entry: matches")).toBeVisible();
    await expect(row).toContainText(recordHash);

    // The record is public and byte-identical to what was hashed on-chain; the named holder list is not.
    const recordHref = (await row.getByRole("link", { name: "JSON" }).getAttribute("href")) ?? "";
    const res = await fetch(new URL(recordHref, E2E_BASE_URL));
    expect(res.status).toBe(200);
    expect(createHash("sha256").update(await res.text()).digest("hex")).toBe(recordHash);
    expect((await fetch(new URL(recordHref.replace(/record$/, "holders"), E2E_BASE_URL))).status).toBe(401);
    await shot(visitor, "21-public-history");
    await context.close();
  });

  test("instituição vê o pagamento recebido, com o registro on-chain, e a posição reavaliada", async () => {
    await inst.goto("/app/pagamentos");
    const row = inst.locator("tr", { hasText: CODE });
    await expect(row).toContainText("R$ 61.728,00");
    await expect(row.getByRole("link", { name: /^tx/ })).toBeVisible();
    const recordHref = (await row.getByRole("link", { name: "registro (JSON)" }).getAttribute("href")) ?? "";
    expect((await inst.request.get(recordHref)).ok()).toBe(true);
    expect((await inst.request.get(recordHref.replace(/record$/, "holders"))).status()).toBe(403); // admin only
    await shot(inst, "22-institution-payments");
    await inst.goto("/app");
    await expect(inst.locator("tr", { hasText: ASSET_NAME })).toContainText("R$ 5.061.700,00");
    await shot(inst, "23-institution-holdings-repriced");
  });

  test("login com passkey e isolamento entre perfis", async () => {
    await inst.getByRole("button", { name: "Sair" }).click();
    await expect(inst).toHaveURL(/\/entrar$/);
    await shot(inst, "24-login");
    await inst.getByRole("button", { name: "Entrar com passkey" }).click();
    await expect(inst).toHaveURL(/\/app$/);
    await expect(inst.getByText(instAddress)).toBeVisible();

    await inst.goto("/admin");
    await expect(inst).toHaveURL(/\/app$/);
    await admin.goto("/app");
    await expect(admin).toHaveURL(/\/admin$/);
    await expect(admin.getByText("Tokens transferidos").first()).toBeVisible();
    await expect(admin.getByText("Proposta fechada com o cliente").first()).toBeVisible();
    await shot(admin, "25-admin-overview-activity");
  });
});

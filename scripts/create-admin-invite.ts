/** pnpm admin:invite pessoa@lastro.com.br  →  prints a one-time admin signup link (72h). */
import "./_env";
import { createAdminInvite } from "../src/lib/invites";
import { env } from "../src/lib/env";

async function main() {
  const email = process.argv[2];
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error("Uso: pnpm admin:invite email@dominio");
    process.exit(1);
  }
  const token = await createAdminInvite(email);
  console.log(`Convite de administrador para ${email.toLowerCase()} (válido por 72h):\n${env().APP_ORIGIN}/convite/${token}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

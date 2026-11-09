import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL é obrigatória"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET precisa de 32+ caracteres"),
  APP_ORIGIN: z.string().url(),
  WEBAUTHN_RP_ID: z.string().min(1),
  WEBAUTHN_RP_NAME: z.string().min(1).default("Lastro"),
  STELLAR_NETWORK: z.enum(["testnet", "public"]).default("testnet"),
  HORIZON_URL: z.string().url().optional(),
  LASTRO_ISSUER_SECRET: z.string().optional(),
  LASTRO_OPERATOR_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Parsed environment. Lazy so that `next build` does not need runtime secrets. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Configuração inválida — ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

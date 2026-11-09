import { env } from "@/lib/env";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Rejects cross-site POSTs to JSON route handlers (server actions have their own check). */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin || origin !== new URL(env().APP_ORIGIN).origin) {
    throw new HttpError(403, "Origem não permitida.");
  }
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/** Wraps a POST route handler: same-origin check + uniform JSON errors. */
export function jsonRoute<C>(handler: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      assertSameOrigin(req);
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status });
      console.error("[api]", err);
      return Response.json({ error: "Erro inesperado. Tente novamente." }, { status: 500 });
    }
  };
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    throw new HttpError(400, "Corpo da requisição inválido.");
  }
}

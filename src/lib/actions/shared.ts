export type ActionState = { error?: string; ok?: string } | undefined;

/** FormData → plain string record (files are ignored). */
export function formObject(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of formData.entries()) if (typeof value === "string") out[key] = value;
  return out;
}

export function actionError(err: unknown, fallback = "Não foi possível concluir. Tente novamente."): ActionState {
  console.error("[action]", err);
  if (err instanceof Error && err.name === "StellarConfigError") return { error: err.message };
  return { error: fallback };
}

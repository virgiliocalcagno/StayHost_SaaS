/**
 * Gemini 2.5 Flash-Lite — traducción ES → EN para textos del catálogo.
 *
 * Usado por:
 *   - /api/upsells POST/PATCH: auto-traduce name/description si el host
 *     no completa los _en manualmente (best-effort, no bloqueante).
 *   - /api/upsells/translate: endpoint dedicado que el form llama cuando el
 *     host clickea "Auto-traducir con IA".
 *
 * GEMINI_API_KEY: misma var que el OCR. Free tier 1500 req/día — alcanza
 * de sobra para traducciones de catálogo (cada upsell es 1 par de campos).
 *
 * Estrategia anti-fail:
 *   - Si la API falla o tarda >15s, devolvemos { ok: false } y el caller
 *     decide. NO rompemos el flow del host: si no hay traducción, se
 *     queda NULL y el hub hace fallback al español.
 *   - Devuelve el texto en string plano, NO JSON-encoded, para que se pueda
 *     escribir directo en BD sin parseo extra.
 */

const GEMINI_MODEL = "gemini-2.5-flash-lite";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  error?: { message?: string };
};

export type TranslationResult = {
  ok: true;
  name?: string | null;
  description?: string | null;
} | {
  ok: false;
  error: string;
};

/**
 * Traduce un par {name, description} de español a inglés.
 *
 * Tono: comercial-turístico breve y limpio. NO inventa info que no esté en
 * la fuente. Si el input es muy genérico, devuelve traducción literal.
 *
 * Pasamos los dos campos juntos en una sola llamada para ahorrar requests
 * y mantener consistencia (ej "Catamarán Bávaro" + descripción que lo
 * mencione, traducidos al mismo término).
 */
export async function translateUpsellToEnglish(input: {
  name?: string | null;
  description?: string | null;
}): Promise<TranslationResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "GEMINI_API_KEY no configurada" };
  }

  const name = (input.name ?? "").trim();
  const description = (input.description ?? "").trim();

  // Si ambos están vacíos no llamamos a Gemini — ahorra cuota.
  if (!name && !description) {
    return { ok: true, name: null, description: null };
  }

  const prompt = `Traducí los siguientes textos del catálogo de un host vacacional dominicano de español a inglés. Mantené tono comercial-turístico breve y profesional. NO inventes información que no esté en la fuente. Conservá nombres propios y marcas tal cual (Bávaro, Punta Cana, PUJ, Brugal, Riu, etc.).

NAME_ES: ${name || "(vacío)"}
DESCRIPTION_ES: ${description || "(vacío)"}

Respondé SOLO con JSON válido con esta forma exacta:
{"name": "<traducción del nombre o null si vacío>", "description": "<traducción de la descripción o null si vacía>"}

Nada de markdown, explicaciones, ni texto antes/después del JSON.`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      response_mime_type: "application/json",
      temperature: 0.2,
      maxOutputTokens: 800,
    },
  };

  let gemResp: GeminiResponse;
  try {
    const res = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      return { ok: false, error: `Gemini ${res.status}: ${errBody.slice(0, 200)}` };
    }
    gemResp = (await res.json()) as GeminiResponse;
  } catch (err) {
    return {
      ok: false,
      error: `No se pudo conectar a Gemini: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (gemResp.error) {
    return { ok: false, error: gemResp.error.message ?? "Gemini error" };
  }

  const rawText = gemResp.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
  if (!rawText) {
    return { ok: false, error: "Gemini no devolvió contenido" };
  }

  try {
    const parsed = JSON.parse(rawText) as { name?: unknown; description?: unknown };
    return {
      ok: true,
      name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : null,
      description:
        typeof parsed.description === "string" && parsed.description.trim()
          ? parsed.description.trim()
          : null,
    };
  } catch {
    return { ok: false, error: "Gemini devolvió texto no-JSON" };
  }
}

/**
 * WhatsApp Business API — Meta Cloud (stub Sprint 7.6).
 *
 * Sin las env vars configuradas, todas las funciones son no-op (devuelven
 * { ok: false, reason: 'not_configured' }). Cuando Virgilio termine el
 * setup Meta y configure las env vars, este helper empieza a mandar
 * mensajes reales sin tocar el código de los callers.
 *
 * SETUP de Virgilio (cuando esté listo):
 *   1) Crear Meta Business Account en business.facebook.com
 *   2) Agregar WhatsApp Business Account (WABA)
 *   3) Verificar negocio (RNC, dominio DNS, número de teléfono)
 *   4) En Meta for Developers, crear app "StayHost" → producto WhatsApp
 *   5) Conseguir System User Access Token + Phone Number ID
 *   6) Crear template aprobado (ej "new_order_notice_es") con variables:
 *        {{1}} = vendorName
 *        {{2}} = guestName
 *        {{3}} = summary (items + fecha)
 *        Botón URL: {{4}} = manageUrl
 *   7) Configurar las env vars en Vercel:
 *        WHATSAPP_BUSINESS_PHONE_ID
 *        WHATSAPP_BUSINESS_TOKEN
 *        WHATSAPP_BUSINESS_TEMPLATE_NAME=new_order_notice_es
 *        WHATSAPP_BUSINESS_TEMPLATE_LANG=es
 *
 * Free tier: 1000 conversaciones business-initiated/mes por WABA. Después
 * ~$0.005-0.015 USD por mensaje "utility" en RD. Suficiente para los
 * primeros meses de Virgilio sin tocar la billetera.
 *
 * Costo cero hasta superar el free tier. La API responde 400 si pasamos
 * el límite — manejamos como error best-effort sin romper el flow.
 */

const META_API_BASE = "https://graph.facebook.com/v21.0";

export type WhatsAppSendResult =
  | { ok: true; messageId: string }
  | { ok: false; reason: "not_configured" }
  | { ok: false; reason: "rate_limited" | "api_error"; detail: string };

/**
 * Manda un notice template al vendor avisando que llegó una orden nueva.
 * Si las env vars NO están seteadas, devuelve { ok: false, reason: 'not_configured' }
 * sin romper nada. El caller debería loguear pero no propagar al huésped.
 */
export async function sendWhatsAppBusinessOrderNotice(args: {
  vendorPhone: string;
  vendorName: string;
  guestName: string;
  summary: string;
  manageUrl: string;
}): Promise<WhatsAppSendResult> {
  const phoneNumberId = process.env.WHATSAPP_BUSINESS_PHONE_ID;
  const token = process.env.WHATSAPP_BUSINESS_TOKEN;
  const templateName = process.env.WHATSAPP_BUSINESS_TEMPLATE_NAME;
  const templateLang = process.env.WHATSAPP_BUSINESS_TEMPLATE_LANG ?? "es";

  if (!phoneNumberId || !token || !templateName) {
    return { ok: false, reason: "not_configured" };
  }

  // Normalizar phone — quitar todo lo que no sea dígito, NO incluir el +.
  // WhatsApp espera el número en formato E.164 SIN el "+" (ej 18091234567).
  const to = args.vendorPhone.replace(/\D/g, "");
  if (!to || to.length < 8) {
    return { ok: false, reason: "api_error", detail: "Phone inválido" };
  }

  // Truncar a límites razonables — Meta acepta hasta ~1000 chars por
  // variable de template, pero más corto es más legible.
  const v1 = args.vendorName.slice(0, 60);
  const v2 = args.guestName.slice(0, 60);
  const v3 = args.summary.slice(0, 200);

  // El template debe tener un botón URL dinámico con {{1}} en el sufijo
  // (Meta restringe — la base URL es estática, solo el suffix variable).
  // Acá pasamos el manageUrl entero como variable del botón. El template
  // tiene que estar diseñado con `https://stay-host.../v/` como prefijo
  // fijo y el resto como variable. Ajustar según template real aprobado.
  // Para v1 lo pasamos en el body como link clickeable también (texto).
  const body = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: templateLang },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: v1 },
            { type: "text", text: v2 },
            { type: "text", text: v3 },
          ],
        },
        {
          type: "button",
          sub_type: "url",
          index: "0",
          parameters: [
            // El URL completo va acá; Meta valida que matchee el prefix
            // configurado en el template.
            { type: "text", text: args.manageUrl },
          ],
        },
      ],
    },
  };

  try {
    const res = await fetch(`${META_API_BASE}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    if (res.status === 429) {
      const text = await res.text().catch(() => "");
      return { ok: false, reason: "rate_limited", detail: text.slice(0, 200) };
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, reason: "api_error", detail: text.slice(0, 200) };
    }

    const json = (await res.json()) as {
      messages?: Array<{ id?: string }>;
    };
    const messageId = json.messages?.[0]?.id ?? "";
    return { ok: true, messageId };
  } catch (err) {
    return {
      ok: false,
      reason: "api_error",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Web Push para vendors — server-to-vendor notifications instantáneas.
 *
 * Usa el estándar Web Push API + VAPID auth. Funciona en Chrome/Edge/
 * Firefox y Safari 16.4+ (iPhone moderno). 100% gratis sin Firebase.
 *
 * Flow:
 *   1) Vendor abre /v/[token] → registra service worker → pide permiso
 *   2) Browser devuelve un PushSubscription con endpoint + keys
 *   3) Endpoint /api/vendor/push-subscribe guarda en vendor_push_subscriptions
 *   4) Cuando hay orden nueva, server llama sendPushToVendor()
 *
 * Env vars requeridas:
 *   VAPID_PUBLIC_KEY  → también expuesto a cliente como NEXT_PUBLIC_VAPID_PUBLIC_KEY
 *   VAPID_PRIVATE_KEY → server-only
 *   VAPID_CONTACT     → email del SaaS (Meta/Apple lo requieren)
 *
 * Si VAPID_* no están seteadas, sendPushToVendor() es no-op (no rompe el
 * flow del host). El email + WhatsApp manual siguen como backup.
 */

import webpush from "web-push";
import { supabaseAdmin } from "@/lib/supabase/admin";

let vapidConfigured = false;

function ensureVapid(): boolean {
  if (vapidConfigured) return true;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const contact = process.env.VAPID_CONTACT ?? "mailto:soporte@stayhost.app";
  if (!pub || !priv) {
    console.warn("[web-push] VAPID keys no configuradas — push notifications deshabilitadas");
    return false;
  }
  webpush.setVapidDetails(contact, pub, priv);
  vapidConfigured = true;
  return true;
}

export type PushPayload = {
  /** Título del notification (visible en lock screen) */
  title: string;
  /** Cuerpo del notification */
  body: string;
  /** URL absoluta a abrir al clickear */
  url?: string;
  /** Tag para de-duplicar notificaciones (mismo tag = reemplaza la previa) */
  tag?: string;
};

type SubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth_key: string;
};

/**
 * Manda push notification a TODAS las subscriptions activas de un vendor.
 * Por qué a todas: el vendor puede tener PWA instalada en móvil + en
 * laptop. Queremos que le entre en ambos.
 *
 * Best-effort: si un push falla (410 Gone = subscription expirada),
 * marcamos esa row como expired y seguimos con las otras. Si VAPID no
 * está configurado, es no-op.
 *
 * Devuelve { sent: N, expired: M } para que el caller logue.
 */
export async function sendPushToVendor(args: {
  vendorId: string;
  payload: PushPayload;
}): Promise<{ sent: number; expired: number }> {
  if (!ensureVapid()) return { sent: 0, expired: 0 };

  const { data: subs } = await supabaseAdmin
    .from("vendor_push_subscriptions")
    .select("id, endpoint, p256dh, auth_key")
    .eq("vendor_id", args.vendorId)
    .is("expired_at", null);

  const subscriptions = (subs ?? []) as SubscriptionRow[];
  if (subscriptions.length === 0) return { sent: 0, expired: 0 };

  // Limit del payload — Web Push tiene un máximo ~4KB; mantenemos chico
  // para garantizar entrega (algunas implementaciones cortan en 3KB).
  const payloadStr = JSON.stringify({
    title: args.payload.title.slice(0, 100),
    body: args.payload.body.slice(0, 400),
    url: args.payload.url,
    tag: args.payload.tag,
  });

  let sent = 0;
  let expired = 0;
  const nowIso = new Date().toISOString();

  // Mandamos en paralelo pero esperamos todo para devolver stats reales.
  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth_key },
          },
          payloadStr,
          {
            TTL: 60 * 60, // 1h — si el device está offline más de eso, se pierde
            urgency: "high",
          },
        );
        sent++;
        // Update last_used_at — útil para limpiar subscriptions zombi.
        await supabaseAdmin
          .from("vendor_push_subscriptions")
          .update({ last_used_at: nowIso } as never)
          .eq("id", sub.id);
      } catch (err: unknown) {
        // 404/410 = subscription muerta. Marcar como expired pero NO borrar
        // (audit). Otros errores los logueamos pero no marcamos expired
        // (puede ser transient — push service caído).
        const e = err as { statusCode?: number };
        if (e?.statusCode === 404 || e?.statusCode === 410) {
          expired++;
          await supabaseAdmin
            .from("vendor_push_subscriptions")
            .update({ expired_at: nowIso } as never)
            .eq("id", sub.id);
        } else {
          console.error(
            `[web-push] send failed for sub ${sub.id} (vendor ${args.vendorId}):`,
            err,
          );
        }
      }
    }),
  );

  return { sent, expired };
}

/**
 * Manda push notification a TODAS las subscriptions activas del HOST
 * (owner/admin del tenant). Sprint 7.8 — vendors decline, recordatorios,
 * alerts críticos del SaaS.
 */
export async function sendPushToHost(args: {
  tenantId: string;
  payload: PushPayload;
}): Promise<{ sent: number; expired: number }> {
  if (!ensureVapid()) return { sent: 0, expired: 0 };

  const { data: subs } = await supabaseAdmin
    .from("host_push_subscriptions")
    .select("id, endpoint, p256dh, auth_key")
    .eq("tenant_id", args.tenantId)
    .is("expired_at", null);

  const subscriptions = (subs ?? []) as SubscriptionRow[];
  if (subscriptions.length === 0) return { sent: 0, expired: 0 };

  const payloadStr = JSON.stringify({
    title: args.payload.title.slice(0, 100),
    body: args.payload.body.slice(0, 400),
    url: args.payload.url,
    tag: args.payload.tag,
  });

  let sent = 0;
  let expired = 0;
  const nowIso = new Date().toISOString();

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth_key },
          },
          payloadStr,
          { TTL: 60 * 60, urgency: "high" },
        );
        sent++;
        await supabaseAdmin
          .from("host_push_subscriptions")
          .update({ last_used_at: nowIso } as never)
          .eq("id", sub.id);
      } catch (err: unknown) {
        const e = err as { statusCode?: number };
        if (e?.statusCode === 404 || e?.statusCode === 410) {
          expired++;
          await supabaseAdmin
            .from("host_push_subscriptions")
            .update({ expired_at: nowIso } as never)
            .eq("id", sub.id);
        } else {
          console.error(
            `[web-push] host send failed for sub ${sub.id} (tenant ${args.tenantId}):`,
            err,
          );
        }
      }
    }),
  );

  return { sent, expired };
}

/** Helper público — sirve para que el cliente sepa si push está disponible. */
export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY ?? null;
}

// Genera mensajes de WhatsApp con instrucciones de acceso para una propiedad.
//
// Modelo: TTLock y caja física NO son exclusivos — una propiedad puede
// tener ambos. La caja a veces es solo de respaldo para el staff y NO
// debe compartirse con el huésped (`keyboxShareWithGuest=false`).
//
// Reglas:
//   - Mensaje al HUÉSPED:
//       * Si hay PIN de TTLock → incluirlo
//       * Si hay caja Y keyboxShareWithGuest → incluirla
//       * Si nada digital ni caja compartida → caer al método de
//         recepción (in_person | doorman)
//   - Mensaje al STAFF:
//       * Si hay caja → SIEMPRE incluirla (la caja es el respaldo del staff)
//       * Si hay TTLock pero no caja → indicar que el PIN del staff está
//         cargado en la cerradura (lo gestiona Acceso-2)
//       * Si no hay nada → coordinación manual

export type AccessMethod = "ttlock" | "keybox" | "in_person" | "doorman";

export interface AccessProperty {
  name: string;
  address?: string | null;
  addressUnit?: string | null;
  neighborhood?: string | null;
  city?: string | null;

  // Modo de recepción cuando NO hay nada digital ni caja compartida
  accessMethod?: AccessMethod | null;

  // Caja física (si existe en esta propiedad)
  keyboxCode?: string | null;
  keyboxLocation?: string | null;
  keyboxPhotoUrl?: string | null;
  keyboxShareWithGuest?: boolean | null; // default true

  // Cerradura inteligente
  ttlockLockId?: string | number | null;

  wifiName?: string | null;
  wifiPassword?: string | null;
}

export interface AccessGuestContext {
  guestName?: string | null;
  pinCode?: string | null; // PIN del huésped (TTLock por reserva)
  checkInTime?: string | null;
  checkOutTime?: string | null;
}

export interface AccessStaffContext {
  staffName?: string | null;
  taskDate?: string | null;
  taskTime?: string | null;
  staffPinCode?: string | null; // futuro Acceso-2: PIN cíclico del staff
}

function hasKeybox(p: AccessProperty): boolean {
  return Boolean(p.keyboxCode && p.keyboxCode.trim());
}

function shareKeyboxWithGuest(p: AccessProperty): boolean {
  return hasKeybox(p) && p.keyboxShareWithGuest !== false;
}

function buildAddressBlock(p: AccessProperty): string {
  const lines: string[] = [];
  if (p.address) {
    const unit = p.addressUnit ? ` ${p.addressUnit}` : "";
    lines.push(`📍 ${p.address}${unit}`);
  }
  const cityLine = [p.neighborhood, p.city].filter(Boolean).join(", ");
  if (cityLine) lines.push(cityLine);
  if (p.address) {
    const fullAddress = [p.address, p.addressUnit, p.neighborhood, p.city].filter(Boolean).join(", ");
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`;
    lines.push(`Ver en mapa: ${mapsUrl}`);
  }
  return lines.join("\n");
}

function buildKeyboxBlock(p: AccessProperty, audience: "guest" | "staff"): string {
  const lines: string[] = [];
  lines.push(`🗝️ *Caja de llaves*`);
  if (p.keyboxLocation) lines.push(`Ubicación: ${p.keyboxLocation}`);
  if (p.keyboxCode) lines.push(`Código: *${p.keyboxCode}*`);
  if (p.keyboxPhotoUrl) lines.push(`Foto: ${p.keyboxPhotoUrl}`);
  if (audience === "staff") {
    lines.push(`Devolvé la llave a la caja al terminar.`);
  } else {
    lines.push(`Sacás la llave, abrís el apartamento, y la dejás dentro al irte.`);
  }
  return lines.join("\n");
}

function buildTTLockGuestBlock(ctx: AccessGuestContext): string | null {
  if (!ctx.pinCode) return null;
  return [
    `🔐 *Cerradura inteligente*`,
    `Tu PIN: *${ctx.pinCode}*`,
    `Marcalo en el teclado de la puerta y se abrirá.`,
  ].join("\n");
}

function buildTTLockStaffBlock(p: AccessProperty, ctx: AccessStaffContext): string | null {
  if (!p.ttlockLockId) return null;
  if (ctx.staffPinCode) {
    return [
      `🔐 *Cerradura inteligente*`,
      `Tu PIN del equipo: *${ctx.staffPinCode}*`,
      `Está activo en tu ventana horaria.`,
    ].join("\n");
  }
  // Sin PIN explícito (Acceso-2 aún no genera). Si hay caja, ese es el
  // canal — no agregamos bloque TTLock para no confundir. Si NO hay caja,
  // dejamos un placeholder para que el staff sepa que tiene que coordinar.
  if (hasKeybox(p)) return null;
  return [
    `🔐 *Cerradura inteligente*`,
    `La propiedad tiene cerradura inteligente. Coordiná conmigo el PIN para esta tarea.`,
  ].join("\n");
}

function buildFallbackReceptionBlock(p: AccessProperty, audience: "guest" | "staff"): string {
  const method = p.accessMethod ?? "in_person";
  if (method === "doorman") {
    return audience === "guest"
      ? [`👋 *Recepción / Conserje*`, `Pasá por recepción al llegar — ya tienen tus datos y te dan la llave.`].join("\n")
      : [`👋 *Recepción / Conserje*`, `Pedí la llave en recepción — ya saben que vas a trabajar.`].join("\n");
  }
  return audience === "guest"
    ? [`🤝 *Te recibimos en persona*`, `Cuando estés cerca, avisame por aquí y te recibo en la puerta.`].join("\n")
    : [`🤝 *Acceso coordinado*`, `Coordiná conmigo el acceso por aquí.`].join("\n");
}

export function buildAccessMessageForGuest(p: AccessProperty, ctx: AccessGuestContext = {}): string {
  const greeting = ctx.guestName ? `¡Hola ${ctx.guestName}! 👋` : `¡Hola! 👋`;
  const lines = [greeting, ``, `Te doy la bienvenida a *${p.name}*.`, ``];

  const addr = buildAddressBlock(p);
  if (addr) lines.push(addr, ``);

  if (ctx.checkInTime || ctx.checkOutTime) {
    const ci = ctx.checkInTime ? `Check-in desde: *${ctx.checkInTime}*` : "";
    const co = ctx.checkOutTime ? `Check-out hasta: *${ctx.checkOutTime}*` : "";
    lines.push([ci, co].filter(Boolean).join("\n"), ``);
  }

  // Acumulamos los bloques de acceso disponibles
  const accessBlocks: string[] = [];
  const ttlock = buildTTLockGuestBlock(ctx);
  if (ttlock) accessBlocks.push(ttlock);
  if (shareKeyboxWithGuest(p)) accessBlocks.push(buildKeyboxBlock(p, "guest"));

  if (accessBlocks.length === 0) {
    accessBlocks.push(buildFallbackReceptionBlock(p, "guest"));
  }

  lines.push(accessBlocks.join("\n\n"));

  if (p.wifiName) {
    lines.push(``, `📶 *WiFi*`, `Red: ${p.wifiName}`);
    if (p.wifiPassword) lines.push(`Contraseña: ${p.wifiPassword}`);
  }

  lines.push(``, `Cualquier duda, me avisás por aquí. ¡Buena estadía! 🌴`);
  return lines.join("\n");
}

export function buildAccessMessageForStaff(p: AccessProperty, ctx: AccessStaffContext = {}): string {
  const greeting = ctx.staffName ? `Hola ${ctx.staffName} 👋` : `Hola 👋`;
  const lines = [greeting, ``, `Datos de acceso para *${p.name}*:`, ``];

  const addr = buildAddressBlock(p);
  if (addr) lines.push(addr, ``);

  if (ctx.taskDate || ctx.taskTime) {
    const dt = [ctx.taskDate, ctx.taskTime].filter(Boolean).join(" · ");
    if (dt) lines.push(`🗓️ Tarea: ${dt}`, ``);
  }

  // Para el staff la caja siempre se incluye si existe (es su respaldo,
  // sin importar el toggle de "compartir con huésped").
  const accessBlocks: string[] = [];
  if (hasKeybox(p)) accessBlocks.push(buildKeyboxBlock(p, "staff"));
  const ttlockBlock = buildTTLockStaffBlock(p, ctx);
  if (ttlockBlock) accessBlocks.push(ttlockBlock);

  if (accessBlocks.length === 0) {
    accessBlocks.push(buildFallbackReceptionBlock(p, "staff"));
  }

  lines.push(accessBlocks.join("\n\n"));
  lines.push(``, `Cualquier cosa me avisás. ¡Gracias!`);
  return lines.join("\n");
}

// Abre WhatsApp con el mensaje pre-armado siguiendo el patrón ya usado en
// CheckInsPanel: Web Share API → wa.me → clipboard fallback.
export async function shareAccessMessage(text: string, phone?: string | null): Promise<void> {
  const cleanPhone = phone?.replace(/\D/g, "") ?? "";

  type NavigatorWithShare = Navigator & { share?: (data: ShareData) => Promise<void> };
  const nav = typeof navigator !== "undefined" ? (navigator as NavigatorWithShare) : null;
  if (nav?.share && !cleanPhone) {
    try {
      await nav.share({ title: "Acceso", text });
      return;
    } catch {
      // siguió rechazado o cancelado — caemos al fallback
    }
  }

  const url = cleanPhone
    ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`
    : `https://wa.me/?text=${encodeURIComponent(text)}`;
  window.open(url, "_blank", "noopener,noreferrer");

  try {
    await navigator.clipboard?.writeText(text);
  } catch {
    // ignore
  }
}

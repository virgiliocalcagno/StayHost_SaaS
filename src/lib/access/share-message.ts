// Genera mensajes de WhatsApp con instrucciones de acceso para una propiedad.
//
// Cubre los 4 métodos: ttlock, keybox (caja física), in_person, doorman.
// El mensaje cambia según el destinatario (staff vs guest) porque la
// limpiadora necesita más detalle operativo y el huésped más calidez.

export type AccessMethod = "ttlock" | "keybox" | "in_person" | "doorman";

export interface AccessProperty {
  name: string;
  address?: string | null;
  addressUnit?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  accessMethod?: AccessMethod | null;
  keyboxCode?: string | null;
  keyboxLocation?: string | null;
  keyboxPhotoUrl?: string | null;
  ttlockLockId?: string | number | null;
  wifiName?: string | null;
  wifiPassword?: string | null;
}

export interface AccessGuestContext {
  guestName?: string | null;
  pinCode?: string | null;
  checkInTime?: string | null;
  checkOutTime?: string | null;
}

export interface AccessStaffContext {
  staffName?: string | null;
  taskDate?: string | null;
  taskTime?: string | null;
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

function buildAccessBlockGuest(p: AccessProperty, ctx: AccessGuestContext): string {
  const method = p.accessMethod ?? "in_person";
  const lines: string[] = [];
  switch (method) {
    case "ttlock":
      lines.push(`🔐 *Acceso por cerradura inteligente*`);
      if (ctx.pinCode) lines.push(`Tu código: *${ctx.pinCode}*`);
      lines.push(`Marcá el código en el teclado de la puerta y se abrirá.`);
      break;
    case "keybox":
      lines.push(`🗝️ *Caja de llaves*`);
      if (p.keyboxLocation) lines.push(`Ubicación: ${p.keyboxLocation}`);
      if (p.keyboxCode) lines.push(`Código de la caja: *${p.keyboxCode}*`);
      if (p.keyboxPhotoUrl) lines.push(`Foto de referencia: ${p.keyboxPhotoUrl}`);
      lines.push(`Sacás la llave, abrís el apartamento, y la dejás dentro al irte.`);
      break;
    case "doorman":
      lines.push(`👋 *Recepción / Conserje*`);
      lines.push(`Pasá por recepción al llegar — ya tienen tus datos y te dan la llave.`);
      break;
    case "in_person":
    default:
      lines.push(`🤝 *Te recibimos en persona*`);
      lines.push(`Cuando estés cerca, avisame por aquí y te recibo en la puerta.`);
      break;
  }
  return lines.join("\n");
}

function buildAccessBlockStaff(p: AccessProperty): string {
  const method = p.accessMethod ?? "in_person";
  const lines: string[] = [];
  switch (method) {
    case "ttlock":
      lines.push(`🔐 *Cerradura inteligente*`);
      lines.push(`Tu PIN ya está cargado en la cerradura. Marcalo en el teclado.`);
      break;
    case "keybox":
      lines.push(`🗝️ *Caja de llaves*`);
      if (p.keyboxLocation) lines.push(`Ubicación: ${p.keyboxLocation}`);
      if (p.keyboxCode) lines.push(`Código: *${p.keyboxCode}*`);
      if (p.keyboxPhotoUrl) lines.push(`Foto: ${p.keyboxPhotoUrl}`);
      lines.push(`Devolvé la llave a la caja al terminar.`);
      break;
    case "doorman":
      lines.push(`👋 *Recepción / Conserje*`);
      lines.push(`Pedí la llave en recepción — ya saben que vas a limpiar.`);
      break;
    case "in_person":
    default:
      lines.push(`🤝 *Sin cerradura inteligente*`);
      lines.push(`Coordiná conmigo el acceso por aquí.`);
      break;
  }
  return lines.join("\n");
}

export function buildAccessMessageForGuest(p: AccessProperty, ctx: AccessGuestContext = {}): string {
  const greeting = ctx.guestName ? `¡Hola ${ctx.guestName}! 👋` : `¡Hola! 👋`;
  const lines = [greeting, ``, `Te doy la bienvenida a *${p.name}*.`, ``];

  const addr = buildAddressBlock(p);
  if (addr) {
    lines.push(addr, ``);
  }

  if (ctx.checkInTime || ctx.checkOutTime) {
    const ci = ctx.checkInTime ? `Check-in desde: *${ctx.checkInTime}*` : "";
    const co = ctx.checkOutTime ? `Check-out hasta: *${ctx.checkOutTime}*` : "";
    lines.push([ci, co].filter(Boolean).join("\n"), ``);
  }

  lines.push(buildAccessBlockGuest(p, ctx));

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

  lines.push(buildAccessBlockStaff(p));
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

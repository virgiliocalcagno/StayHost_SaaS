/**
 * Mensaje WhatsApp prearmado que la cleaner/maintenance envía al supervisor
 * cuando necesita apoyo durante una tarea. La cleaner completa después de
 * los dos puntos (ej. "no encuentro la llave del ático").
 *
 * Por privacidad NO incluimos datos del huésped — el mensaje sólo identifica
 * al staff, la propiedad y la franja horaria.
 */
export interface HelpMessageContext {
  staffName?: string | null;
  propertyName?: string | null;
  dueTime?: string | null;
}

export function buildHelpMessage(ctx: HelpMessageContext): string {
  const who = (ctx.staffName || "").trim() || "tu equipo";
  const where = ctx.propertyName || "la propiedad";
  const when = ctx.dueTime ? ` (salida ${ctx.dueTime})` : "";
  return `Hola, soy ${who}. Estoy en ${where}${when} y necesito apoyo con: `;
}

/**
 * Construye un href listo para `<a target="_blank">` con el mensaje
 * prearmado. Devuelve null si no hay número.
 */
export function buildHelpWhatsappHref(
  whatsappNumber: string | null | undefined,
  ctx: HelpMessageContext,
): string | null {
  if (!whatsappNumber) return null;
  const digits = whatsappNumber.replace(/[^\d]/g, "");
  if (!digits) return null;
  const text = encodeURIComponent(buildHelpMessage(ctx));
  return `https://wa.me/${digits}?text=${text}`;
}

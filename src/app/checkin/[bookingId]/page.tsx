"use client";

/**
 * Guest Check-in Flow — /checkin/[bookingId]?d=[base64]
 * Fresh, light, resort-style design — Caribbean hospitality feel.
 *
 * Encoded data keys:
 *   n=guestName, l=lastName(auth), d4=last4digits(doorcode)
 *   ci=checkin, co=checkout, nt=nights
 *   p=propertyName, pa=address, pi=image
 *   ws=wifiSsid, wp=wifiPassword
 *   ee=electricityEnabled, et=electricityTotal
 *   us=[{id,n,p,d}] upsells available
 *
 * Steps: 0 Bienvenida → 1 Verificación → 2 Documento → 3 Extras → 4 Electricidad → 5 Acceso
 */

import { useState, useRef, use, Suspense, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";

// ─── Types ────────────────────────────────────────────────────────────────────

interface UpsellItem { id: string; n: string; p: number; d: string; }

interface DecodedBooking {
  n: string; l: string; d4: string;
  ci: string; co: string; nt: number;
  p: string; pa?: string; pi?: string;
  ws?: string; wp?: string;
  ee?: boolean; et?: number; er?: number;
  ch?: string;                   // canal: airbnb / vrbo / direct / ical
  ow?: string;                   // WhatsApp del owner (E.164)
  us?: UpsellItem[];
}

type Step = 0 | 1 | 2 | 3 | 4 | 5;
const STEPS = ["Bienvenida", "Verificación", "Documento", "Extras", "Electricidad", "Acceso"];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function decodeBooking(encoded: string): DecodedBooking | null {
  try { return JSON.parse(decodeURIComponent(escape(atob(encoded)))); }
  catch { return null; }
}

function fmtDate(iso: string) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  const months = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
  return `${d} ${months[+m-1]} ${y}`;
}

function qr(data: string, size = 200) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(data)}&bgcolor=ffffff&color=0f172a&margin=8`;
}

function copyText(text: string, cb: () => void) {
  navigator.clipboard.writeText(text).catch(() => {
    const el = document.createElement("textarea");
    el.value = text; document.body.appendChild(el); el.select();
    document.execCommand("copy"); document.body.removeChild(el);
  });
  cb();
}

// ─── Inner page ───────────────────────────────────────────────────────────────

function CheckInInner({ bookingId }: { bookingId: string }) {
  const sp = useSearchParams();
  // Memoizamos el booking: sin esto, cada render crea un objeto nuevo (porque
  // `decodeBooking` hace JSON.parse), las deps del useEffect de abajo cambian
  // en cada render, y el setStep(2) del initial jump se dispara DESPUES de
  // que el usuario ya avanzo al Paso 3/4, devolviendolo al 2 (loop).
  const dParam = sp.get("d") ?? "";
  const booking = useMemo(() => decodeBooking(dParam), [dParam]);

  // v=2 indica que el huésped viene del landing genérico /checkin donde ya
  // validó con el codigo de reserva. Se salta el paso 1 (apellido+4dig) —
  // usamos el código como pseudo-apellido interno para que el backend
  // autentique sin pedir nada más.
  const isV2 = sp.get("v") === "2";

  const [step, setStep] = useState<Step>(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Step 1 — precargado desde el landing si viene v=2
  const [lastName, setLastName] = useState(() => (isV2 ? (booking?.l ?? "") : ""));
  const [last4, setLast4] = useState(() => (isV2 ? (booking?.d4 ?? "") : ""));

  // Initial jump a Paso 2 cuando viene con v=2. Usamos un ref one-shot para
  // garantizar que se dispare UNA sola vez — sin esto, si el useEffect
  // corriese multiples veces volveria al Paso 2 aunque el usuario haya
  // avanzado.
  const didInitialJumpRef = useRef(false);
  useEffect(() => {
    if (isV2 && booking && !didInitialJumpRef.current) {
      didInitialJumpRef.current = true;
      setStep(2);
    }
  }, [isV2, booking]);

  // Step 2 — foto + OCR + datos de contacto (flujo adaptativo)
  type Step2State = {
    hasPhoto: boolean;
    photoStatus: string;
    needsPhoto: boolean;
    ocr: { name?: string | null; document?: string | null; nationality?: string | null; confidence?: number | null } | null;
    contact: { email: string | null; whatsapp: string | null; guests: number | null };
    typed: { name: string | null; document: string | null; nationality: string | null };
    needsEmail: boolean;
    needsWhatsapp: boolean;
    needsGuestCount: boolean;
    waitingForAuth: boolean;
    authReason: string | null;
    requiresManualReview: boolean;
    completed: boolean;
    completedAt: string | null;
  };
  const [step2State, setStep2State] = useState<Step2State | null>(null);
  const [idPreview, setIdPreview] = useState<string | null>(null);
  const [idBase64, setIdBase64] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestWhatsapp, setGuestWhatsapp] = useState("");
  const [guestCount, setGuestCount] = useState<number>(1);
  const [typedName, setTypedName] = useState("");
  const [typedDocument, setTypedDocument] = useState("");
  const [typedNationality, setTypedNationality] = useState("");
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [ocrAttempts, setOcrAttempts] = useState(0);
  const [ocrFailedLast, setOcrFailedLast] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  // Estados del Paso 3/5 — declarados aqui porque los usa el polling del Paso 5 mas abajo
  const [electricityPaid, setElectricityPaid] = useState(false);
  const [waitingAuthElectric, setWaitingAuthElectric] = useState(false);
  const [copiedSsid, setCopiedSsid] = useState(false);
  const [copiedPass, setCopiedPass] = useState(false);

  // Fetch del estado inicial cuando llegamos al Paso 2 — permite flujo
  // adaptativo: si el host ya cargo email/foto, no los pedimos al huesped.
  useEffect(() => {
    if (step !== 2 || !isV2 || !booking) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/checkin/step2", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "getState", id: bookingId, code: booking.l }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as { state?: Step2State };
        if (cancelled || !data.state) return;
        setStep2State(data.state);
        if (data.state.contact.email) setGuestEmail(data.state.contact.email);
        if (data.state.contact.whatsapp) setGuestWhatsapp(data.state.contact.whatsapp);
        if (data.state.contact.guests) setGuestCount(data.state.contact.guests);
        // Prellenado de nombre/doc/nacionalidad — prioridad:
        //   1) guest_typed_* (si el huesped ya tipeo antes)
        //   2) ocr_* (si el OCR los leyo de la foto)
        //   3) vacio (para que el huesped tipee)
        setTypedName(data.state.typed.name ?? data.state.ocr?.name ?? "");
        setTypedDocument(data.state.typed.document ?? data.state.ocr?.document ?? "");
        setTypedNationality(data.state.typed.nationality ?? data.state.ocr?.nationality ?? "");
        setOcrAttempts(data.state.ocr ? 1 : 0);
        // Si el checkin ya fue completado en una visita anterior, saltamos
        // directo al Paso 5 (Guest Hub con pase de acceso).
        if (data.state.completed) {
          setStep(5);
        }
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [step, isV2, booking, bookingId]);

  // Polling de la Sala de Espera — mientras el huesped este en el Paso 5
  // esperando autorizacion del host, consultamos getState cada 5s para
  // detectar cuando el host apriete "Autorizar" en el dashboard. Apenas
  // waiting_for_auth pasa a false, el render re-evalua y muestra el Paso 5
  // normal con PIN/WiFi.
  const waitingForAnything = (step2State?.waitingForAuth ?? false) || waitingAuthElectric;
  useEffect(() => {
    if (step !== 5 || !waitingForAnything || !booking) return;
    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/checkin/step2", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "getState", id: bookingId, code: booking.l }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as { state?: Step2State };
        if (cancelled || !data.state) return;
        setStep2State(data.state);
        // Si el host autorizo, desactivamos ambos flags y el render muestra
        // la pantalla normal con acceso liberado.
        if (!data.state.waitingForAuth) {
          setWaitingAuthElectric(false);
        }
      } catch { /* silent */ }
    }, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [step, waitingForAnything, booking, bookingId]);

  // Marcar el checkin como completado cuando el huesped llega al Paso 5
  // con acceso liberado (no en Sala de Espera). Idempotente: la API ignora
  // la llamada si checkin_completed_at ya esta seteado. Sirve para que, si
  // el huesped reabre el link, la app lo lleve directo al Guest Hub en
  // lugar de repetir el formulario del Paso 2.
  const completeCalledRef = useRef(false);
  useEffect(() => {
    if (step !== 5 || !booking) return;
    if (step2State?.waitingForAuth || waitingAuthElectric) return;
    if (step2State?.completed) return;
    if (completeCalledRef.current) return;
    completeCalledRef.current = true;
    (async () => {
      try {
        const res = await fetch("/api/checkin/step2", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "complete", id: bookingId, code: booking.l }),
        });
        if (res.ok) {
          const data = (await res.json()) as { state?: Step2State };
          if (data.state) setStep2State(data.state);
        }
      } catch { /* silent — no bloquea al huesped */ }
    })();
  }, [step, booking, bookingId, step2State, waitingAuthElectric]);

  // Upsells legacy — se mantiene la variable para no romper refs pero ya no
  // se renderizan en el wizard (movidos al Guest Hub post-checkin).
  const upsells = booking?.us ?? [];
  const upsellsTotal = 0;

  // ── Auth ────────────────────────────────────────────────────────────────────
  function handleAuth() {
    if (!booking) { setError("Enlace inválido. Pide un nuevo enlace a tu anfitrión."); return; }
    if (!lastName.trim() || last4.length !== 4) { setError("Ingresa tu apellido y los 4 dígitos."); return; }
    if (booking.l.toLowerCase().trim() !== lastName.toLowerCase().trim() || booking.d4 !== last4) {
      setError("Datos incorrectos. Verifica tu apellido y los últimos 4 dígitos de tu teléfono.");
      return;
    }
    setError(""); setStep(2);
  }

  // ── ID upload ───────────────────────────────────────────────────────────────

  // Redimensiona y recomprime la foto en el navegador antes de enviarla.
  // Vercel corta bodies >4.5MB; una foto de iPhone (4-8MB) sale siempre
  // rechazada. 1600px/quality 0.72 deja el documento legible en ~200-500KB.
  async function compressImage(file: File): Promise<string> {
    const dataUrl: string = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result as string);
      r.onerror = () => rej(new Error("read"));
      r.readAsDataURL(file);
    });
    const img: HTMLImageElement = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("decode"));
      i.src = dataUrl;
    });
    const MAX = 1600;
    const scale = Math.min(1, MAX / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.72);
  }

  const [ocrRunning, setOcrRunning] = useState(false);
  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { setError("Imagen demasiado grande (máx 20MB)."); return; }
    if (!booking) return;
    try {
      const compressed = await compressImage(file);
      setIdBase64(compressed);
      setIdPreview(compressed);
      setError("");

      // Subimos la foto y corremos el OCR al instante — antes de que el
      // huesped apriete Continuar. Asi el OCR llena nombre/doc/nacionalidad
      // automaticamente y el huesped solo tiene que revisar/corregir.
      setOcrRunning(true);
      try {
        const res = await fetch("/api/checkin/step2", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "submit",
            id: bookingId,
            code: booking.l,
            idPhotoBase64: compressed,
          }),
        });
        if (res.ok) {
          const data = (await res.json()) as { state?: Step2State };
          if (data.state) {
            setStep2State(data.state);
            // Si el huesped todavia no tipeo nada, volcamos los datos del OCR
            // en los inputs. Si ya habia tipeado algo, respetamos su input.
            const ocr = data.state.ocr;
            if (ocr) {
              if (!typedName.trim() && ocr.name) setTypedName(ocr.name);
              if (!typedDocument.trim() && ocr.document) setTypedDocument(ocr.document);
              if (!typedNationality.trim() && ocr.nationality) setTypedNationality(ocr.nationality);
            }
            const ocrOk = ocr && (ocr.confidence ?? 0) >= 0.5 && ocr.name;
            setOcrAttempts((n) => n + 1);
            setOcrFailedLast(!ocrOk);
            if (!ocrOk) {
              setError(ocrAttempts + 1 >= 2
                ? "Tuvimos dificultades leyendo tu documento. Completá los datos a mano."
                : "No pudimos leer bien tu documento. Probá con otra foto con mejor luz, o completá los datos a mano.");
            }
          }
        } else {
          const msg = await res.json().catch(() => ({ error: "" }));
          setError((msg.error || "No pudimos procesar la foto.") + ` (error ${res.status})`);
        }
      } catch (err) {
        const detail = err instanceof Error ? ` — ${err.message}` : "";
        setError("No pudimos procesar la foto. Completá los datos a mano." + detail);
      } finally {
        setOcrRunning(false);
      }
    } catch {
      setError("No pudimos procesar la imagen. Probá otra foto.");
    }
  }

  // Valida email basico (formato xxx@xxx.xx). No hace DNS lookup.
  function isEmailValid(v: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
  }
  function isWhatsappValid(v: string): boolean {
    // Minimo 8 digitos (con o sin +, espacios, guiones)
    const digits = v.replace(/\D/g, "");
    return digits.length >= 8 && digits.length <= 15;
  }

  // Envia foto (si es nueva) + datos de contacto al endpoint /api/checkin/step2.
  // Flujo adaptativo: solo manda los campos que cambiaron.
  async function handleSubmitStep2() {
    if (!booking) return;

    // Validaciones obligatorias. Foto puede omitirse si ya hay una subida previa.
    const needsPhoto = !step2State?.hasPhoto && !idBase64;
    if (needsPhoto) { setError("Subí una foto de tu documento."); return; }
    if (typedName.trim().length < 3) { setError("Ingresá tu nombre completo."); return; }
    if (typedDocument.trim().length < 4) { setError("Ingresá tu número de documento."); return; }
    if (!isEmailValid(guestEmail)) { setError("Ingresá un email válido."); return; }
    if (!isWhatsappValid(guestWhatsapp)) { setError("Ingresá un WhatsApp válido (mínimo 8 dígitos)."); return; }
    if (!guestCount || guestCount < 1) { setError("¿Cuántas personas se quedan? Mínimo 1."); return; }
    if (!consentAccepted) { setError("Debés aceptar las reglas de la casa para continuar."); return; }

    setLoading(true);
    try {
      const body: Record<string, unknown> = {
        action: "submit",
        id: bookingId,
        code: booking.l,
        email: guestEmail,
        whatsapp: guestWhatsapp,
        guestCount,
        typedName,
        typedDocument,
        typedNationality,
        consentAccepted: true,
      };
      // Solo re-enviamos la foto si el backend todavia no la tiene.
      // handleFile ya la sube apenas el huesped la elige, asi que en el
      // camino feliz esta condicion es false y el submit va liviano.
      if (idBase64 && !step2State?.hasPhoto) body.idPhotoBase64 = idBase64;

      const res = await fetch("/api/checkin/step2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const msg = await res.json().catch(() => ({ error: "" }));
        setError((msg.error || "No pudimos guardar tus datos.") + ` (error ${res.status})`);
        setLoading(false);
        return;
      }

      const data = (await res.json()) as { state?: Step2State };
      if (data.state) {
        setStep2State(data.state);
        // Si la foto fue subida y el OCR tiene confianza baja o no extrajo nombre → incrementamos attempts
        if (idBase64) {
          const ocrOk = data.state.ocr && (data.state.ocr.confidence ?? 0) >= 0.5 && data.state.ocr.name;
          setOcrFailedLast(!ocrOk);
          setOcrAttempts((n) => n + 1);
          if (!ocrOk) {
            setLoading(false);
            setError(ocrAttempts + 1 >= 2
              ? "Tuvimos dificultades leyendo tu documento."
              : "No pudimos leer bien tu documento. Probá con otra foto con mejor luz.");
            return;
          }
        }
      }
    } catch (err) {
      const detail = err instanceof Error ? ` — ${err.message}` : "";
      setError("Error de conexión. Intentá de nuevo." + detail);
      setLoading(false);
      return;
    }

    setLoading(false);
    setError("");
    // Saltamos Step 3 (upsells removidos). Si la propiedad no cobra electricidad → salta directo al 5.
    setStep(booking?.ee ? 4 : 5);
  }

  // Fallback: el huesped pide autorizacion manual al host cuando OCR no lee.
  async function handleRequestAuth() {
    if (!booking) return;
    setLoading(true);
    try {
      await fetch("/api/checkin/step2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "requestAuth", id: bookingId, code: booking.l, reason: "ocr_failed" }),
      });
    } catch { /* silent */ }

    // Abre WhatsApp del anfitrion. Si el tenant no tiene owner_whatsapp
    // configurado, no abre nada — el huesped queda en sala de espera igual,
    // el host va a ver el pendiente en el dashboard.
    const link = hostWhatsappLink("ocr");
    if (link) window.open(link, "_blank");
    setLoading(false);
    setError("");
    // Avanzamos al Paso 5 con estado "esperando autorizacion"
    setStep(5);
    setStep2State((s) => s ? { ...s, waitingForAuth: true, authReason: "ocr_failed" } : s);
  }

  // ── Electricity ─────────────────────────────────────────────────────────────
  function handlePay() { setElectricityPaid(true); setStep(5); }

  // Arma el link wa.me al owner con mensaje pre-rellenado. Si el tenant
  // no tiene owner_whatsapp configurado, devuelve null (el boton no abre
  // WA, solo muestra el estado de espera).
  function hostWhatsappLink(reason: "ocr" | "electricity"): string | null {
    const phone = (booking?.ow ?? "").replace(/\D/g, "");
    if (!phone || phone.length < 8) return null;
    const msg =
      reason === "ocr"
        ? `Hola, soy ${booking?.n ?? "el huésped"} (reserva ${booking?.l}). Estoy haciendo check-in en ${booking?.p ?? "la propiedad"} pero la app no pudo leer mi documento. ¿Podrías autorizarme?`
        : `Hola, soy ${booking?.n ?? "el huésped"} (reserva ${booking?.l}). Hice mi check-in en ${booking?.p ?? "la propiedad"} y elegí solicitar autorización para el cargo eléctrico. Quedo atento a tus instrucciones.`;
    return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
  }

  // El huesped selecciona "Solicitar autorizacion" (Airbnb Centro de
  // Resoluciones o transferencia/efectivo para directas). Marca el
  // checkin en backend como waiting_for_auth=true y abre WhatsApp del
  // anfitrion con mensaje pre-rellenado.
  async function handleRequestAuthElectric() {
    if (!booking) return;
    setLoading(true);
    try {
      await fetch("/api/checkin/step2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "requestAuth",
          id: bookingId,
          code: booking.l,
          reason: "electricity_pending",
        }),
      });
    } catch { /* silent */ }

    const link = hostWhatsappLink("electricity");
    if (link) window.open(link, "_blank");

    setLoading(false);
    setError("");
    setWaitingAuthElectric(true);
    setStep(5);
  }

  // ── No data ─────────────────────────────────────────────────────────────────
  if (!booking && step === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-sky-50 to-amber-50 flex items-center justify-center p-6">
        <div className="text-center space-y-4 max-w-xs">
          <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto text-3xl">🔗</div>
          <h2 className="text-xl font-bold text-slate-800">Enlace no válido</h2>
          <p className="text-slate-500 text-sm">Este enlace de check-in no contiene datos de reserva. Contacta a tu anfitrión para obtener el enlace correcto.</p>
        </div>
      </div>
    );
  }

  // ── Layout shell ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-50 via-white to-amber-50/30">

      {/* Header */}
      <header className="bg-white/80 backdrop-blur-sm border-b border-slate-100 px-5 py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-orange-500 flex items-center justify-center text-white text-sm font-bold">S</div>
          <span className="font-bold text-slate-800">Stay<span className="text-orange-500">Host</span></span>
        </div>
        <span className="text-xs text-slate-400 font-medium uppercase tracking-widest">Check-in</span>
      </header>

      {/* Progress steps */}
      {step > 0 && step < 5 && (
        <div className="bg-white border-b border-slate-100 px-5 py-3">
          <div className="flex items-center gap-1 max-w-md mx-auto">
            {[1,2,3,4].map(s => (
              <div key={s} className="flex-1 flex flex-col items-center gap-1">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                  s < step ? "bg-emerald-500 text-white" : s === step ? "bg-orange-500 text-white" : "bg-slate-100 text-slate-400"}`}>
                  {s < step ? "✓" : s}
                </div>
                {s < 4 && <div className={`h-0.5 w-full mt-3 ${s < step ? "bg-emerald-300" : "bg-slate-100"}`} />}
              </div>
            ))}
          </div>
          <p className="text-center text-xs text-slate-400 mt-1.5">{STEPS[step]}</p>
        </div>
      )}

      <main className="max-w-md mx-auto px-5 py-6 space-y-5">

        {/* ── Step 0: Welcome ──────────────────────────────────────────────── */}
        {step === 0 && booking && (
          <div className="space-y-5">
            {/* Hero */}
            <div className="relative rounded-3xl overflow-hidden h-48">
              {booking.pi ? (
                <img src={booking.pi} alt={booking.p} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-sky-400 to-cyan-500 flex items-center justify-center text-6xl">🌴</div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
              <div className="absolute bottom-4 left-4 text-white">
                <h1 className="text-2xl font-bold">{booking.p}</h1>
                {booking.pa && <p className="text-sm text-white/80 flex items-center gap-1">📍 {booking.pa}</p>}
              </div>
            </div>

            {/* Dates card */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center bg-sky-50 rounded-xl p-3">
                  <p className="text-xs text-sky-600 font-semibold uppercase tracking-wide mb-1">Llegada</p>
                  <p className="text-slate-800 font-bold">{fmtDate(booking.ci)}</p>
                  <p className="text-xs text-slate-400">3:00 PM</p>
                </div>
                <div className="text-center bg-orange-50 rounded-xl p-3">
                  <p className="text-xs text-orange-600 font-semibold uppercase tracking-wide mb-1">Salida</p>
                  <p className="text-slate-800 font-bold">{fmtDate(booking.co)}</p>
                  <p className="text-xs text-slate-400">11:00 AM</p>
                </div>
              </div>
              <div className="flex items-center justify-between text-sm border-t border-slate-100 pt-3">
                <span className="text-slate-500">Duración</span>
                <span className="font-semibold text-slate-800">{booking.nt} noche{booking.nt > 1 ? "s" : ""}</span>
              </div>
              {booking.n && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">Huésped</span>
                  <span className="font-semibold text-slate-800">{booking.n}</span>
                </div>
              )}
            </div>

            {/* Steps preview */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 space-y-3">
              <p className="text-sm font-semibold text-slate-700">Tu proceso de check-in:</p>
              {[
                { emoji: "🛡️", label: "Verificar identidad", done: false },
                { emoji: "📷", label: "Foto de tu documento", done: false },
                ...(upsells.length > 0 ? [{ emoji: "🛍️", label: `${upsells.length} servicios extra disponibles`, done: false }] : []),
                ...(booking.ee !== false ? [{ emoji: "⚡", label: "Pagar tarifa eléctrica", done: false }] : []),
                { emoji: "🗝️", label: "Recibir WiFi y código de entrada", done: false },
              ].map((s, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xl">{s.emoji}</span>
                  <span className="text-sm text-slate-600">{s.label}</span>
                </div>
              ))}
            </div>

            <button type="button" onClick={() => setStep(1)}
              className="w-full bg-orange-500 hover:bg-orange-600 active:scale-95 text-white font-bold py-4 rounded-2xl transition-all shadow-md shadow-orange-200">
              Comenzar Check-in →
            </button>
          </div>
        )}

        {/* ── Step 1: Verify ───────────────────────────────────────────────── */}
        {step === 1 && (
          <div className="space-y-5">
            <div className="text-center pt-4 space-y-2">
              <div className="text-5xl">🛡️</div>
              <h2 className="text-xl font-bold text-slate-800">Verificación</h2>
              <p className="text-slate-500 text-sm">Confirma tu identidad para continuar.</p>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Apellido</label>
                <input type="text" value={lastName}
                  onChange={e => { setLastName(e.target.value); setError(""); }}
                  placeholder="Rodríguez"
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-slate-800 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent text-base bg-slate-50"
                  autoCapitalize="words" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Últimos 4 dígitos de tu teléfono</label>
                <input type="number" value={last4}
                  onChange={e => { setLast4(e.target.value.slice(0,4)); setError(""); }}
                  placeholder="_ _ _ _"
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-slate-800 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent text-3xl text-center tracking-[0.6em] font-mono bg-slate-50"
                  inputMode="numeric" />
              </div>
            </div>

            {error && <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-600 text-sm text-center">{error}</div>}

            <button type="button" onClick={handleAuth}
              disabled={!lastName.trim() || last4.length !== 4}
              className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-slate-200 disabled:text-slate-400 active:scale-95 text-white font-bold py-4 rounded-2xl transition-all shadow-md shadow-orange-200">
              Verificar →
            </button>
          </div>
        )}

        {/* ── Step 2: ID + Datos de Contacto (flujo adaptativo) ───────────── */}
        {step === 2 && (
          <div className="space-y-5">
            <div className="text-center pt-4 space-y-2">
              <div className="text-5xl">📷</div>
              <h2 className="text-xl font-bold text-slate-800">Documento y Contacto</h2>
              <p className="text-slate-500 text-sm">Subí tu documento y completá los datos faltantes.</p>
            </div>

            {/* ── Seccion foto ──────────────────────────────────────────── */}
            <input ref={cameraRef} type="file" accept="image/*" capture="environment"
              title="Tomar foto con camara"
              aria-label="Tomar foto del documento con la camara"
              onChange={handleFile} className="hidden" />
            <input ref={galleryRef} type="file" accept="image/*"
              title="Subir desde galeria"
              aria-label="Subir foto del documento desde galeria o archivos"
              onChange={handleFile} className="hidden" />

            {/* Nota: los datos leidos por OCR se vuelcan directo en los
                inputs editables abajo (nombre/doc/nacionalidad) con una
                etiqueta "✓ Leídos del documento" en el encabezado de la
                seccion. No renderizamos el viejo recuadro read-only. */}

            {/* Seccion foto — separada del bloque de datos. Si ya hay foto
                subida, muestra preview o estado; si no, 2 botones para subir. */}
            {idPreview ? (
              <div className="relative rounded-2xl overflow-hidden border-2 border-orange-300 shadow-sm">
                <img src={idPreview} alt="Documento" className="w-full max-h-48 object-contain bg-slate-50" />
                {ocrRunning && (
                  <div className="absolute inset-0 bg-slate-900/70 flex flex-col items-center justify-center text-white gap-2">
                    <div className="text-3xl animate-pulse">🔍</div>
                    <p className="text-sm font-semibold">Leyendo tu documento…</p>
                  </div>
                )}
                <button type="button"
                  onClick={() => {
                    setIdPreview(null);
                    setIdBase64("");
                    if (cameraRef.current) cameraRef.current.value = "";
                    if (galleryRef.current) galleryRef.current.value = "";
                  }}
                  className="absolute top-2 right-2 w-7 h-7 bg-white/90 rounded-full flex items-center justify-center text-slate-600 shadow text-lg">×</button>
              </div>
            ) : step2State?.hasPhoto ? (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-center gap-2 text-sm text-emerald-700">
                <span className="text-lg">✅</span>
                <span>Foto del documento ya subida.</span>
                <button type="button" onClick={() => cameraRef.current?.click()}
                  className="ml-auto text-xs font-semibold text-emerald-600 underline">Cambiar</button>
              </div>
            ) : (
              <>
                {step2State?.ocr?.name && (
                  <p className="text-center text-xs text-slate-500 px-4">
                    Falta la <strong>foto</strong> de tu documento para validar.
                  </p>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <button type="button" onClick={() => cameraRef.current?.click()}
                    className="bg-orange-50 hover:bg-orange-100 active:scale-95 border-2 border-orange-200 rounded-2xl py-6 flex flex-col items-center gap-2 transition-all">
                    <span className="text-4xl">📸</span>
                    <span className="text-sm font-semibold text-orange-700">Tomar foto</span>
                  </button>
                  <button type="button" onClick={() => galleryRef.current?.click()}
                    className="bg-sky-50 hover:bg-sky-100 active:scale-95 border-2 border-sky-200 rounded-2xl py-6 flex flex-col items-center gap-2 transition-all">
                    <span className="text-4xl">🖼️</span>
                    <span className="text-sm font-semibold text-sky-700">Subir de galería</span>
                  </button>
                </div>
              </>
            )}

            {/* ── Fallback OCR atascado — autorizacion manual ───────────── */}
            {ocrFailedLast && ocrAttempts >= 2 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3 text-sm">
                <p className="font-semibold text-amber-800">No pudimos leer tu documento</p>
                <p className="text-amber-700 text-xs">Podemos avanzar igual — tu anfitrión te autorizará manualmente en minutos.</p>
                <button type="button" onClick={handleRequestAuth} disabled={loading}
                  className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-semibold py-2.5 rounded-xl text-sm flex items-center justify-center gap-2 disabled:opacity-50">
                  💬 Pedir autorización al anfitrión
                </button>
              </div>
            )}

            {/* ── Datos del huesped (editables, prellenados por OCR) ───── */}
            <div className="bg-white rounded-2xl border border-slate-100 p-4 space-y-4 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Tus datos</p>
                {step2State?.ocr?.name && (
                  <span className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wider flex items-center gap-1">
                    <span>✓</span> Leídos del documento
                  </span>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600" htmlFor="typedName">Nombre completo *</label>
                <input id="typedName" type="text" autoComplete="name"
                  value={typedName}
                  onChange={(e) => { setTypedName(e.target.value); setError(""); }}
                  placeholder="Como aparece en tu documento"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-slate-50" />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600" htmlFor="typedDocument">Número de documento *</label>
                <input id="typedDocument" type="text" inputMode="text" autoComplete="off"
                  value={typedDocument}
                  onChange={(e) => { setTypedDocument(e.target.value); setError(""); }}
                  placeholder="Pasaporte o ID"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-400 bg-slate-50" />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600" htmlFor="typedNationality">Nacionalidad</label>
                <input id="typedNationality" type="text" autoComplete="country-name"
                  value={typedNationality}
                  onChange={(e) => { setTypedNationality(e.target.value); setError(""); }}
                  placeholder="Ej: Dominicana, Argentina, USA"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-slate-50" />
              </div>
            </div>

            {/* ── Datos de contacto (adaptativos) ──────────────────────── */}
            <div className="bg-white rounded-2xl border border-slate-100 p-4 space-y-4 shadow-sm">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Tus datos de contacto</p>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600" htmlFor="guestEmail">Email *</label>
                <input id="guestEmail" type="email" inputMode="email" autoComplete="email"
                  value={guestEmail}
                  onChange={(e) => { setGuestEmail(e.target.value); setError(""); }}
                  placeholder="tunombre@ejemplo.com"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-slate-50" />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600" htmlFor="guestWhatsapp">WhatsApp *</label>
                <input id="guestWhatsapp" type="tel" inputMode="tel" autoComplete="tel"
                  value={guestWhatsapp}
                  onChange={(e) => { setGuestWhatsapp(e.target.value); setError(""); }}
                  placeholder="+1 809 555 1234"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-slate-50" />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600" htmlFor="guestCount">¿Cuántas personas se quedan? *</label>
                <input id="guestCount" type="number" min={1} max={20}
                  value={guestCount}
                  onChange={(e) => { setGuestCount(parseInt(e.target.value || "1", 10)); setError(""); }}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-slate-50" />
              </div>
            </div>

            {/* ── Advertencia de consentimiento informado ──────────────── */}
            <label className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-3 cursor-pointer">
              <input type="checkbox" checked={consentAccepted}
                onChange={(e) => setConsentAccepted(e.target.checked)}
                className="mt-0.5 w-5 h-5 accent-orange-500 flex-shrink-0" />
              <span className="text-xs text-amber-800 leading-relaxed">
                <strong>Aceptás las reglas de la casa</strong> (previamente informadas al confirmar tu reserva).
                Tus códigos de puerta se enviarán a los contactos de arriba. <strong>Si los datos son falsos, no podrás ingresar.</strong>
              </span>
            </label>

            {error && <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-600 text-sm text-center">{error}</div>}

            <button type="button" onClick={handleSubmitStep2}
              disabled={loading || ocrRunning}
              className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-slate-200 disabled:text-slate-400 active:scale-95 text-white font-bold py-4 rounded-2xl transition-all shadow-md shadow-orange-200">
              {loading ? "Procesando..." : ocrRunning ? "Leyendo documento…" : "Continuar →"}
            </button>
          </div>
        )}

        {/*
          Step 3 (upsells) fue removido del wizard segun spec 2026-04-22.
          Los servicios extra viven en el Guest Hub post-checkin (accesible
          via QR) para no frenar el registro con decisiones de compra.
          Las variables upsells/upsellsTotal/selected se mantienen solo
          por compatibilidad con el tipo DecodedBooking.
        */}

        {/* ── Step 4: Electricidad (reactivo por canal) ──────────────────── */}
        {step === 4 && (
          <div className="space-y-5">
            <div className="text-center pt-4 space-y-2">
              <div className="text-5xl">⚡</div>
              <h2 className="text-xl font-bold text-slate-800">Tarifa Eléctrica</h2>
              <p className="text-slate-500 text-sm">Cargo por consumo durante tu estadía.</p>
            </div>

            {/* Consentimiento informado — requerido en TODO paso donde aparece el cobro */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 leading-snug">
              <p><strong>⚠️ Este cargo está informado en las reglas de la casa</strong> que aceptaste antes y después de confirmar tu reserva. Es parte integral del acuerdo.</p>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 space-y-3">
              <div className="flex justify-between text-sm"><span className="text-slate-500">Tarifa por noche</span><span className="font-medium text-slate-800">${((booking?.et ?? 0) / (booking?.nt ?? 1)).toFixed(2)} USD</span></div>
              <div className="flex justify-between text-sm"><span className="text-slate-500">Noches</span><span className="font-medium text-slate-800">× {booking?.nt}</span></div>
              <div className="border-t border-slate-100 pt-3 flex justify-between">
                <span className="font-bold text-slate-800">Total</span>
                <span className="text-2xl font-bold text-orange-500">${(booking?.et ?? 0).toFixed(2)} USD</span>
              </div>
            </div>

            {/* Botones reactivos por canal */}
            {booking?.ch === "airbnb" ? (
              <>
                <button type="button" onClick={handlePay}
                  className="w-full bg-[#0070BA] hover:bg-[#005ea6] active:scale-95 text-white font-bold py-4 rounded-2xl transition-all shadow-md flex items-center justify-center gap-2">
                  💳 Pagar con PayPal o Tarjeta — ${(booking?.et ?? 0).toFixed(2)}
                </button>
                <button type="button" onClick={handleRequestAuthElectric} disabled={loading}
                  className="w-full bg-white border-2 border-slate-200 hover:border-slate-300 active:scale-95 text-slate-700 font-semibold py-3.5 rounded-2xl text-sm disabled:opacity-50">
                  Pedir cargo a Airbnb (Centro de Resoluciones)
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={handlePay}
                  className="w-full bg-[#0070BA] hover:bg-[#005ea6] active:scale-95 text-white font-bold py-4 rounded-2xl transition-all shadow-md flex items-center justify-center gap-2">
                  💳 Pagar Online (PayPal / Tarjeta) — ${(booking?.et ?? 0).toFixed(2)}
                </button>
                <button type="button" onClick={handleRequestAuthElectric} disabled={loading}
                  className="w-full bg-white border-2 border-slate-200 hover:border-slate-300 active:scale-95 text-slate-700 font-semibold py-3.5 rounded-2xl text-sm disabled:opacity-50">
                  Solicitar autorización (transferencia o efectivo)
                </button>
              </>
            )}

            <p className="text-center text-[11px] text-slate-400">
              Si elegís "solicitar autorización", tu acceso se libera cuando el anfitrión confirme el pago.
            </p>
          </div>
        )}

        {/* ── Step 5: Access / Sala de Espera ──────────────────────────────── */}
        {step === 5 && booking && (step2State?.waitingForAuth || waitingAuthElectric) && (
          <div className="space-y-5">
            <div className="bg-gradient-to-br from-amber-400 to-orange-500 rounded-3xl p-6 text-white text-center space-y-3 shadow-lg shadow-amber-200">
              <div className="text-5xl">⏳</div>
              <h2 className="text-2xl font-bold">Registro completo</h2>
              <p className="text-amber-50 text-sm leading-relaxed">
                Tu check-in está listo pero tu acceso está en pausa hasta que
                tu anfitrión confirme{" "}
                {step2State?.authReason === "ocr_failed"
                  ? "tu identidad"
                  : step2State?.authReason === "electricity_pending" || waitingAuthElectric
                    ? "el pago de la tarifa eléctrica"
                    : "tu registro"}.
              </p>
            </div>

            <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-3 text-sm">
              <p className="font-semibold text-slate-700">Qué sigue ahora:</p>
              <ul className="space-y-2 text-slate-600">
                <li className="flex gap-2"><span>1.</span> Tu anfitrión fue notificado automáticamente.</li>
                <li className="flex gap-2"><span>2.</span> Una vez que autorice, esta pantalla se actualiza sola con tu código y WiFi.</li>
                <li className="flex gap-2"><span>3.</span> Si hay demoras, podés escribirle directamente.</li>
              </ul>
            </div>

            {/* Boton contacto directo — solo si el tenant configuro su WA */}
            {booking.ow && (() => {
              const reason = step2State?.waitingForAuth ? "ocr" : "electricity";
              const link = hostWhatsappLink(reason);
              if (!link) return null;
              return (
                <a href={link} target="_blank" rel="noopener noreferrer"
                  className="w-full bg-[#25D366] hover:bg-[#1da851] active:scale-95 text-white font-semibold py-3.5 rounded-2xl text-sm flex items-center justify-center gap-2 transition-all shadow-sm">
                  💬 Contactar anfitrión por WhatsApp
                </a>
              );
            })()}

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-600 text-center space-y-1">
              <p>🔒 Tu PIN y WiFi se muestran cuando el anfitrión autorice.</p>
              <p className="text-[11px] text-slate-400 flex items-center justify-center gap-1.5">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Verificando estado cada 5 segundos…
              </p>
            </div>
          </div>
        )}

        {step === 5 && booking && !(step2State?.waitingForAuth || waitingAuthElectric) && (
          <div className="space-y-5">
            {/* Welcome banner */}
            <div className="bg-gradient-to-br from-emerald-400 to-teal-500 rounded-3xl p-6 text-white text-center space-y-2 shadow-lg shadow-emerald-200">
              <div className="text-4xl">🎉</div>
              <h2 className="text-2xl font-bold">¡Bienvenido, {booking.n}!</h2>
              <p className="text-emerald-100 text-sm">Todo listo para tu estadía en {booking.p}</p>
            </div>

            {/* Door code — most important, shown first */}
            <div className="bg-white rounded-2xl shadow-sm border-2 border-amber-200 p-5 text-center space-y-2">
              <p className="text-xs font-bold text-amber-600 uppercase tracking-widest">🗝️ Código de Puerta</p>
              <p className="text-6xl font-black text-slate-800 tracking-[0.4em] font-mono">{booking.d4}</p>
              <p className="text-xs text-slate-400">{fmtDate(booking.ci)} — {fmtDate(booking.co)}</p>
            </div>

            {/* WiFi */}
            {booking.ws && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 space-y-4">
                <p className="text-xs font-bold text-sky-600 uppercase tracking-widest">📶 WiFi</p>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-500">Red</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold text-slate-800">{booking.ws}</span>
                      <button type="button" onClick={() => copyText(booking.ws!, () => { setCopiedSsid(true); setTimeout(() => setCopiedSsid(false), 2000); })}
                        className="text-sky-400 hover:text-sky-600 transition-colors text-sm" title="Copiar red">
                        {copiedSsid ? "✓" : "📋"}
                      </button>
                    </div>
                  </div>
                  {booking.wp && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-500">Contraseña</span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold text-slate-800">{booking.wp}</span>
                        <button type="button" onClick={() => copyText(booking.wp!, () => { setCopiedPass(true); setTimeout(() => setCopiedPass(false), 2000); })}
                          className="text-sky-400 hover:text-sky-600 transition-colors text-sm" title="Copiar contraseña">
                          {copiedPass ? "✓" : "📋"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                {/* WiFi QR */}
                {booking.wp && (
                  <div className="pt-1 text-center">
                    <p className="text-xs text-slate-400 mb-2">Escanea para conectarte en 1 toque</p>
                    <div className="inline-block bg-white rounded-2xl p-3 shadow-sm border border-slate-100">
                      <img src={qr(`WIFI:T:WPA;S:${booking.ws};P:${booking.wp};;`, 160)} alt="WiFi QR" width={160} height={160} className="rounded-xl" />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Direccion + Google Maps */}
            {booking.pa && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 space-y-3">
                <p className="text-xs font-bold text-rose-500 uppercase tracking-widest">📍 Cómo Llegar</p>
                <p className="text-slate-700 text-sm">{booking.pa}</p>
                <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(booking.pa)}`}
                  target="_blank" rel="noopener noreferrer"
                  className="w-full bg-rose-500 hover:bg-rose-600 active:scale-95 text-white font-bold py-3 rounded-xl text-sm flex items-center justify-center gap-2 transition-all shadow-sm">
                  🗺️ Abrir en Google Maps
                </a>
              </div>
            )}

            {/* Access QR */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 space-y-3 text-center">
              <p className="text-xs font-bold text-violet-600 uppercase tracking-widest">🏠 Pase de Entrada</p>
              <p className="text-xs text-slate-400">Muéstrale este QR al vigilante en la entrada</p>
              <div className="flex justify-center">
                <div className="inline-block bg-white rounded-2xl p-3 shadow-sm border border-slate-100">
                  <img src={qr(JSON.stringify({ id: bookingId, guest: `${booking.n} ${booking.l}`, property: booking.p, checkin: booking.ci, checkout: booking.co }))}
                    alt="Pase QR" width={200} height={200} className="rounded-xl" />
                </div>
              </div>
              <p className="text-xs font-mono text-slate-300">{bookingId.slice(-8).toUpperCase()}</p>
            </div>
          </div>
        )}

      </main>

      <footer className="text-center py-6 text-slate-300 text-xs">
        StayHost · Check-in Digital
      </footer>
    </div>
  );
}

// ─── Default export with Suspense ─────────────────────────────────────────────

export default function CheckInPage({ params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = use(params);
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-b from-sky-50 to-amber-50 flex items-center justify-center">
        <div className="text-4xl animate-bounce">🌴</div>
      </div>
    }>
      <CheckInInner bookingId={bookingId} />
    </Suspense>
  );
}

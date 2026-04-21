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

import { useState, useRef, use, Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";

// ─── Types ────────────────────────────────────────────────────────────────────

interface UpsellItem { id: string; n: string; p: number; d: string; }

interface DecodedBooking {
  n: string; l: string; d4: string;
  ci: string; co: string; nt: number;
  p: string; pa?: string; pi?: string;
  ws?: string; wp?: string;
  ee?: boolean; et?: number;
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
  const booking = decodeBooking(sp.get("d") ?? "");

  // v=2 indica que el huésped viene del landing genérico /checkin donde ya
  // validó (código + últimos 4 dígitos). No tiene que pasar por el paso 1
  // (apellido+4dig) — usamos el código como pseudo-apellido interno para
  // que el backend autentique sin pedir nada más.
  const isV2 = sp.get("v") === "2";

  const [step, setStep] = useState<Step>(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Step 1 — precargado desde el landing si viene v=2
  const [lastName, setLastName] = useState(() => (isV2 ? (booking?.l ?? "") : ""));
  const [last4, setLast4] = useState(() => (isV2 ? (booking?.d4 ?? "") : ""));

  // v=2 → saltamos bienvenida y auth, vamos directo a subir documento
  useEffect(() => {
    if (isV2 && booking) setStep(2);
  }, [isV2, booking]);

  // Step 2
  const [idPreview, setIdPreview] = useState<string | null>(null);
  const [idBase64, setIdBase64] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Step 3 — upsells
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const upsells = booking?.us ?? [];
  const upsellsTotal = upsells.filter(u => selected.has(u.id)).reduce((s, u) => s + u.p, 0);

  // Step 4 — electricity
  const [electricityPaid, setElectricityPaid] = useState(false);

  // Step 5 — copy flags
  const [copiedSsid, setCopiedSsid] = useState(false);
  const [copiedPass, setCopiedPass] = useState(false);

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

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { setError("Imagen demasiado grande (máx 20MB)."); return; }
    try {
      const compressed = await compressImage(file);
      setIdBase64(compressed);
      setIdPreview(compressed);
      setError("");
    } catch {
      setError("No pudimos procesar la imagen. Probá otra foto.");
    }
  }

  async function handleUploadId() {
    if (!idBase64) { setError("Selecciona una foto de tu documento."); return; }
    setLoading(true);
    try {
      // Pasamos el soft token (lastName + last4) porque el endpoint lo exige
      // para aceptar uploads desde el flujo de huésped sin sesión.
      const res = await fetch("/api/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "uploadId", id: bookingId, lastName, last4, idPhotoBase64: idBase64 }),
      });
      if (!res.ok) {
        const msg = await res.json().catch(() => ({ error: "" }));
        setError(msg.error || "No pudimos subir la foto. Intentá de nuevo.");
        setLoading(false);
        return;
      }
    } catch {
      setError("Error de conexión. Revisá tu internet e intentá de nuevo.");
      setLoading(false);
      return;
    }
    setLoading(false); setError("");
    setStep(upsells.length > 0 ? 3 : (booking?.ee !== false ? 4 : 5));
  }

  // ── Upsells → next ──────────────────────────────────────────────────────────
  function handleUpsellsNext() {
    setStep(booking?.ee !== false ? 4 : 5);
  }

  // ── Electricity ─────────────────────────────────────────────────────────────
  function handlePay() { setElectricityPaid(true); setStep(5); }

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

        {/* ── Step 2: ID Upload ────────────────────────────────────────────── */}
        {step === 2 && (
          <div className="space-y-5">
            <div className="text-center pt-4 space-y-2">
              <div className="text-5xl">📷</div>
              <h2 className="text-xl font-bold text-slate-800">Documento de Identidad</h2>
              <p className="text-slate-500 text-sm">Foto clara de tu pasaporte, cédula o licencia.</p>
            </div>

            <input ref={fileRef} type="file" accept="image/*"
              title="Seleccionar foto de documento de identidad"
              aria-label="Subir foto de documento de identidad"
              onChange={handleFile} className="hidden" />

            {idPreview ? (
              <div className="relative rounded-2xl overflow-hidden border-2 border-orange-300 shadow-sm">
                <img src={idPreview} alt="Documento" className="w-full max-h-52 object-contain bg-slate-50" />
                <button type="button"
                  onClick={() => { setIdPreview(null); setIdBase64(""); if (fileRef.current) fileRef.current.value = ""; }}
                  className="absolute top-2 right-2 w-7 h-7 bg-white/90 rounded-full flex items-center justify-center text-slate-600 shadow text-lg">×</button>
              </div>
            ) : (
              <button type="button" onClick={() => fileRef.current?.click()}
                className="w-full bg-slate-50 hover:bg-sky-50 border-2 border-dashed border-slate-200 hover:border-sky-300 rounded-2xl py-10 flex flex-col items-center gap-3 transition-colors">
                <span className="text-4xl">📄</span>
                <span className="text-sm text-slate-500">Toca para tomar foto o subir archivo</span>
                <span className="text-xs text-slate-400">JPG, PNG — máx 8MB</span>
              </button>
            )}

            <div className="bg-sky-50 border border-sky-100 rounded-xl p-3 text-sky-700 text-xs space-y-1">
              <p className="font-semibold">¿Por qué lo necesitamos?</p>
              <p>Requerido por regulaciones de alojamiento turístico. Tu información es confidencial.</p>
            </div>

            {error && <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-600 text-sm text-center">{error}</div>}

            <button type="button" onClick={handleUploadId}
              disabled={loading || !idBase64}
              className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-slate-200 disabled:text-slate-400 active:scale-95 text-white font-bold py-4 rounded-2xl transition-all shadow-md shadow-orange-200">
              {loading ? "Enviando..." : "Enviar Documento →"}
            </button>
          </div>
        )}

        {/* ── Step 3: Upsells / Extras ─────────────────────────────────────── */}
        {step === 3 && (
          <div className="space-y-5">
            <div className="text-center pt-4 space-y-2">
              <div className="text-5xl">🛍️</div>
              <h2 className="text-xl font-bold text-slate-800">Servicios Extra</h2>
              <p className="text-slate-500 text-sm">Opcional — mejora tu estadía con estos servicios.</p>
            </div>

            <div className="space-y-3">
              {upsells.map(u => {
                const on = selected.has(u.id);
                return (
                  <button key={u.id} type="button"
                    onClick={() => setSelected(prev => {
                      const next = new Set(prev);
                      on ? next.delete(u.id) : next.add(u.id);
                      return next;
                    })}
                    className={`w-full text-left rounded-2xl border-2 p-4 transition-all ${on ? "border-orange-400 bg-orange-50 shadow-sm" : "border-slate-200 bg-white hover:border-slate-300"}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-800">{u.n}</p>
                        <p className="text-sm text-slate-500 mt-0.5">{u.d}</p>
                      </div>
                      <div className="text-right ml-3 shrink-0">
                        <p className="text-lg font-bold text-orange-500">${u.p}</p>
                        <div className={`w-5 h-5 rounded-full border-2 ml-auto mt-1 flex items-center justify-center text-xs ${on ? "bg-orange-500 border-orange-500 text-white" : "border-slate-300"}`}>
                          {on && "✓"}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {upsellsTotal > 0 && (
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 flex items-center justify-between">
                <span className="text-orange-700 text-sm font-medium">Extras seleccionados</span>
                <span className="text-orange-600 font-bold">${upsellsTotal} USD</span>
              </div>
            )}

            <button type="button" onClick={handleUpsellsNext}
              className="w-full bg-orange-500 hover:bg-orange-600 active:scale-95 text-white font-bold py-4 rounded-2xl transition-all shadow-md shadow-orange-200">
              {selected.size > 0 ? `Continuar con ${selected.size} extra${selected.size > 1 ? "s" : ""} →` : "Continuar sin extras →"}
            </button>
          </div>
        )}

        {/* ── Step 4: Electricity ──────────────────────────────────────────── */}
        {step === 4 && (
          <div className="space-y-5">
            <div className="text-center pt-4 space-y-2">
              <div className="text-5xl">⚡</div>
              <h2 className="text-xl font-bold text-slate-800">Tarifa Eléctrica</h2>
              <p className="text-slate-500 text-sm">Pago por consumo eléctrico durante tu estadía.</p>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 space-y-3">
              <div className="flex justify-between text-sm"><span className="text-slate-500">Tarifa por noche</span><span className="font-medium text-slate-800">${((booking?.et ?? 0) / (booking?.nt ?? 1)).toFixed(2)} USD</span></div>
              <div className="flex justify-between text-sm"><span className="text-slate-500">Noches</span><span className="font-medium text-slate-800">× {booking?.nt}</span></div>
              <div className="flex justify-between text-sm"><span className="text-slate-500">Comisión PayPal</span><span className="font-medium text-slate-800">incluida</span></div>
              {upsellsTotal > 0 && <div className="flex justify-between text-sm"><span className="text-slate-500">Extras</span><span className="font-medium text-slate-800">${upsellsTotal} USD</span></div>}
              <div className="border-t border-slate-100 pt-3 flex justify-between">
                <span className="font-bold text-slate-800">Total</span>
                <span className="text-2xl font-bold text-orange-500">${((booking?.et ?? 0) + upsellsTotal).toFixed(2)} USD</span>
              </div>
            </div>

            <button type="button" onClick={handlePay}
              className="w-full bg-[#0070BA] hover:bg-[#005ea6] active:scale-95 text-white font-bold py-4 rounded-2xl transition-all shadow-md flex items-center justify-center gap-2">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                <path d="M7.5 5.5C9.5 3.7 12.5 3.7 14.5 5.5L20 11c1.8 1.8 1.8 4.7 0 6.5s-4.7 1.8-6.5 0L7 11C5.2 9.2 5.2 6.3 7 4.5" opacity=".6"/>
                <path d="M16.5 18.5c-2 1.8-5 1.8-7 0L4 13c-1.8-1.8-1.8-4.7 0-6.5s4.7-1.8 6.5 0L17 13c1.8 1.8 1.8 4.7 0 6.5"/>
              </svg>
              Pagar con PayPal — ${((booking?.et ?? 0) + upsellsTotal).toFixed(2)}
            </button>

            <button type="button" onClick={() => setStep(5)}
              className="w-full text-slate-400 text-sm py-2 hover:text-slate-600 transition-colors">
              Pagar después en recepción
            </button>
          </div>
        )}

        {/* ── Step 5: Access ───────────────────────────────────────────────── */}
        {step === 5 && booking && (
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

            {/* Access QR for Titan Coloso */}
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

            {/* Selected upsells summary */}
            {selected.size > 0 && (
              <div className="bg-orange-50 border border-orange-100 rounded-2xl p-4 space-y-2">
                <p className="text-xs font-bold text-orange-600 uppercase tracking-widest">🛍️ Extras Confirmados</p>
                {upsells.filter(u => selected.has(u.id)).map(u => (
                  <div key={u.id} className="flex justify-between text-sm">
                    <span className="text-slate-600">{u.n}</span>
                    <span className="font-semibold text-orange-500">${u.p}</span>
                  </div>
                ))}
                <p className="text-xs text-slate-400 pt-1">El equipo te contactará para coordinar los detalles.</p>
              </div>
            )}
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

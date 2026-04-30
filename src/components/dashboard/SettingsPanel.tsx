"use client";

/**
 * SettingsPanel — configuración del propio cliente (tenant).
 *
 * Tabs:
 *   1. Mi Perfil — nombre + email (readonly) + cambiar contraseña
 *   2. Mi Negocio — empresa, contacto público (email + WhatsApp)
 *   3. Mi Hub — preview del Hub público + URL + mensaje bienvenida + logo
 *   4. Pagos — placeholder honesto (próximamente, no mock)
 *   5. Zona peligro — eliminar cuenta
 *
 * Datos:
 *   - Lee de GET /api/settings (un fetch al montar)
 *   - Guarda con PATCH /api/settings (campos validados)
 *   - Cambia password con POST /api/settings/password
 *   - Elimina cuenta con DELETE /api/settings/account (requiere "ELIMINAR")
 */

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  CreditCard,
  Settings as SettingsIcon,
  User,
  Building,
  Globe,
  AlertTriangle,
  Copy,
  ExternalLink,
  Loader2,
  Save,
  KeyRound,
  Lock,
} from "lucide-react";
import Link from "next/link";

type SettingsData = {
  id: string;
  email: string;
  name: string | null;
  company: string | null;
  contactEmail: string | null;
  ownerWhatsapp: string | null;
  hubWelcomeMessage: string | null;
  logoUrl: string | null;
  plan: string | null;
  planExpiresAt: string | null;
};

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "ok" } | { kind: "err"; msg: string };

export default function SettingsPanel() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<SettingsData | null>(null);
  const [draft, setDraft] = useState<SettingsData | null>(null);
  const [profileSave, setProfileSave] = useState<SaveState>({ kind: "idle" });
  const [businessSave, setBusinessSave] = useState<SaveState>({ kind: "idle" });
  const [hubSave, setHubSave] = useState<SaveState>({ kind: "idle" });
  const [pwdSave, setPwdSave] = useState<SaveState>({ kind: "idle" });
  const [pwd, setPwd] = useState({ next: "", confirm: "" });
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  // Pagos (PayPal por ahora). Carga separada para no obligar a otro fetch
  // si el host no abre la pestaña.
  const [paypalConfig, setPaypalConfig] = useState<{
    clientId: string;
    clientSecret: string; // siempre vacío; el real está enmascarado en BD
    clientSecretMasked: string | null; // muestra los últimos 4 si existe
    mode: "sandbox" | "live";
    enabled: boolean;
    hasSecret: boolean;
  }>({
    clientId: "",
    clientSecret: "",
    clientSecretMasked: null,
    mode: "sandbox",
    enabled: false,
    hasSecret: false,
  });
  const [paypalLoading, setPaypalLoading] = useState(true);
  const [paypalSave, setPaypalSave] = useState<SaveState>({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/settings/payments", { cache: "no-store", credentials: "include" });
        if (!res.ok) return;
        const json = (await res.json()) as {
          configs: Array<{
            provider: string;
            clientId: string | null;
            clientSecretMasked: string | null;
            mode: string;
            enabled: boolean;
          }>;
        };
        const pp = json.configs.find((c) => c.provider === "paypal");
        if (!cancelled && pp) {
          setPaypalConfig({
            clientId: pp.clientId ?? "",
            clientSecret: "",
            clientSecretMasked: pp.clientSecretMasked,
            mode: (pp.mode === "live" ? "live" : "sandbox") as "sandbox" | "live",
            enabled: pp.enabled,
            hasSecret: !!pp.clientSecretMasked,
          });
        }
      } finally {
        if (!cancelled) setPaypalLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const savePaypal = async () => {
    setPaypalSave({ kind: "saving" });
    try {
      const res = await fetch("/api/settings/payments", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "paypal",
          clientId: paypalConfig.clientId,
          // Si el campo está vacío y ya hay un secret en BD, el backend mantiene
          // el anterior. Si el host quiere reemplazarlo, pega uno nuevo.
          clientSecret: paypalConfig.clientSecret,
          mode: paypalConfig.mode,
          enabled: paypalConfig.enabled,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      // Limpiamos el campo de secret y marcamos hasSecret si lo cargaron.
      setPaypalConfig((prev) => ({
        ...prev,
        clientSecret: "",
        hasSecret: prev.hasSecret || !!prev.clientSecret,
        clientSecretMasked: prev.clientSecret
          ? `••••••••${prev.clientSecret.slice(-4)}`
          : prev.clientSecretMasked,
      }));
      setPaypalSave({ kind: "ok" });
      setTimeout(() => setPaypalSave({ kind: "idle" }), 2500);
    } catch (e) {
      setPaypalSave({ kind: "err", msg: (e as Error).message });
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/settings", { cache: "no-store", credentials: "include" });
        if (!res.ok) throw new Error(await res.text());
        const json = (await res.json()) as SettingsData;
        if (!cancelled) {
          setData(json);
          setDraft(json);
        }
      } catch {
        // Si falla, dejamos data en null y el panel muestra error.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const update = (patch: Partial<SettingsData>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
  };

  // Guarda solo los campos que cambiaron en cada sección, así un error en
  // "Mi Negocio" no rompe la edición de "Mi Hub".
  const save = async (
    section: "profile" | "business" | "hub",
    fields: Partial<SettingsData>,
    setState: (s: SaveState) => void
  ) => {
    if (!draft) return;
    setState({ kind: "saving" });
    try {
      const body: Record<string, unknown> = {};
      if ("name" in fields) body.name = fields.name;
      if ("company" in fields) body.company = fields.company;
      if ("contactEmail" in fields) body.contactEmail = fields.contactEmail;
      if ("ownerWhatsapp" in fields) body.ownerWhatsapp = fields.ownerWhatsapp;
      if ("hubWelcomeMessage" in fields) body.hubWelcomeMessage = fields.hubWelcomeMessage;
      if ("logoUrl" in fields) body.logoUrl = fields.logoUrl;

      const res = await fetch("/api/settings", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      setData((prev) => (prev ? { ...prev, ...fields } : prev));
      setState({ kind: "ok" });
      setTimeout(() => setState({ kind: "idle" }), 2500);
    } catch (e) {
      setState({ kind: "err", msg: (e as Error).message });
    }
    void section;
  };

  const changePassword = async () => {
    setPwdSave({ kind: "saving" });
    if (pwd.next.length < 8) {
      setPwdSave({ kind: "err", msg: "Mínimo 8 caracteres" });
      return;
    }
    if (pwd.next !== pwd.confirm) {
      setPwdSave({ kind: "err", msg: "Las contraseñas no coinciden" });
      return;
    }
    try {
      const res = await fetch("/api/settings/password", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: pwd.next }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      setPwd({ next: "", confirm: "" });
      setPwdSave({ kind: "ok" });
      setTimeout(() => setPwdSave({ kind: "idle" }), 2500);
    } catch (e) {
      setPwdSave({ kind: "err", msg: (e as Error).message });
    }
  };

  const deleteAccount = async () => {
    setDeleting(true);
    setDeleteErr(null);
    try {
      const res = await fetch("/api/settings/account", {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "ELIMINAR" }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      // Tras borrar la cuenta, el cookie de sesión queda huérfano. Lo más limpio
      // es ir a /salir que ya hace logout y manda a /acceso.
      window.location.assign("/salir");
    } catch (e) {
      setDeleteErr((e as Error).message);
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data || !draft) {
    return (
      <div className="space-y-4 max-w-2xl">
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader>
            <CardTitle className="text-destructive">No se pudo cargar la configuración</CardTitle>
            <CardDescription>
              Recargá la página. Si el problema persiste, contactá a soporte.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const hubUrl = typeof window !== "undefined" ? `${window.location.origin}/hub/${data.id}` : `/hub/${data.id}`;

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-bold tracking-tight">Configuración</h2>
        <p className="text-muted-foreground">
          Tu perfil, tu negocio, tu Hub público y datos de pago.
        </p>
      </div>

      <Tabs defaultValue="profile" className="space-y-4">
        <TabsList className="bg-muted/50 p-1 flex-wrap h-auto">
          <TabsTrigger value="profile" className="gap-2">
            <User className="h-4 w-4" /> Mi Perfil
          </TabsTrigger>
          <TabsTrigger value="business" className="gap-2">
            <Building className="h-4 w-4" /> Mi Negocio
          </TabsTrigger>
          <TabsTrigger value="hub" className="gap-2">
            <Globe className="h-4 w-4" /> Mi Hub
          </TabsTrigger>
          <TabsTrigger value="payments" className="gap-2">
            <CreditCard className="h-4 w-4" /> Pagos
          </TabsTrigger>
          <TabsTrigger value="danger" className="gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4" /> Zona peligro
          </TabsTrigger>
        </TabsList>

        {/* ─── MI PERFIL ─────────────────────────────────────────────────── */}
        <TabsContent value="profile" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Información personal</CardTitle>
              <CardDescription>Tu nombre y email de inicio de sesión.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Nombre completo</Label>
                  <Input
                    value={draft.name ?? ""}
                    onChange={(e) => update({ name: e.target.value })}
                    placeholder="Juan Pérez"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Email (no editable)</Label>
                  <Input value={data.email} disabled />
                  <p className="text-xs text-muted-foreground">
                    Para cambiar el email, contactá a soporte.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  onClick={() => save("profile", { name: draft.name }, setProfileSave)}
                  disabled={profileSave.kind === "saving" || draft.name === data.name}
                  className="gap-2"
                >
                  {profileSave.kind === "saving" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  Guardar cambios
                </Button>
                {profileSave.kind === "ok" && (
                  <span className="text-sm text-emerald-600">Guardado</span>
                )}
                {profileSave.kind === "err" && (
                  <span className="text-sm text-destructive">{profileSave.msg}</span>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="h-4 w-4" /> Cambiar contraseña
              </CardTitle>
              <CardDescription>Mínimo 8 caracteres.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Nueva contraseña</Label>
                  <Input
                    type="password"
                    value={pwd.next}
                    onChange={(e) => setPwd((p) => ({ ...p, next: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Confirmar nueva contraseña</Label>
                  <Input
                    type="password"
                    value={pwd.confirm}
                    onChange={(e) => setPwd((p) => ({ ...p, confirm: e.target.value }))}
                  />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  onClick={changePassword}
                  disabled={pwdSave.kind === "saving" || !pwd.next || !pwd.confirm}
                  className="gap-2"
                >
                  {pwdSave.kind === "saving" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <KeyRound className="h-4 w-4" />
                  )}
                  Actualizar contraseña
                </Button>
                {pwdSave.kind === "ok" && (
                  <span className="text-sm text-emerald-600">Contraseña actualizada</span>
                )}
                {pwdSave.kind === "err" && (
                  <span className="text-sm text-destructive">{pwdSave.msg}</span>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── MI NEGOCIO ───────────────────────────────────────────────── */}
        <TabsContent value="business" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Datos del negocio</CardTitle>
              <CardDescription>
                Esta información es la que el huésped ve cuando entra a tu Hub público.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Nombre del negocio</Label>
                <Input
                  value={draft.company ?? ""}
                  onChange={(e) => update({ company: e.target.value })}
                  placeholder="Villas del Caribe"
                />
                <p className="text-xs text-muted-foreground">
                  Si lo dejás vacío, el Hub muestra tu nombre personal.
                </p>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Email público de contacto</Label>
                  <Input
                    type="email"
                    value={draft.contactEmail ?? ""}
                    onChange={(e) => update({ contactEmail: e.target.value })}
                    placeholder="contacto@minegocio.com"
                  />
                  <p className="text-xs text-muted-foreground">
                    Lo verá el huésped en el Hub. Si lo dejás vacío, se usa tu email de login.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>WhatsApp de contacto</Label>
                  <Input
                    value={draft.ownerWhatsapp ?? ""}
                    onChange={(e) => update({ ownerWhatsapp: e.target.value })}
                    placeholder="+18091234567"
                  />
                  <p className="text-xs text-muted-foreground">
                    Formato internacional con +. Lo usa el huésped en la sala de espera.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  onClick={() =>
                    save(
                      "business",
                      {
                        company: draft.company,
                        contactEmail: draft.contactEmail,
                        ownerWhatsapp: draft.ownerWhatsapp,
                      },
                      setBusinessSave
                    )
                  }
                  disabled={
                    businessSave.kind === "saving" ||
                    (draft.company === data.company &&
                      draft.contactEmail === data.contactEmail &&
                      draft.ownerWhatsapp === data.ownerWhatsapp)
                  }
                  className="gap-2"
                >
                  {businessSave.kind === "saving" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  Guardar negocio
                </Button>
                {businessSave.kind === "ok" && (
                  <span className="text-sm text-emerald-600">Guardado</span>
                )}
                {businessSave.kind === "err" && (
                  <span className="text-sm text-destructive">{businessSave.msg}</span>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── MI HUB ──────────────────────────────────────────────────── */}
        <TabsContent value="hub" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Tu Hub público</CardTitle>
              <CardDescription>
                Es la página pública donde el huésped descubre tus propiedades. Compartila por
                WhatsApp, redes o impresa con QR.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>URL del Hub</Label>
                <div className="flex gap-2">
                  <Input value={hubUrl} readOnly className="font-mono text-xs" />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => navigator.clipboard.writeText(hubUrl)}
                    title="Copiar"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button asChild type="button" variant="outline" size="icon" title="Abrir">
                    <Link href={`/hub/${data.id}`} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4" />
                    </Link>
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Próximamente vas a poder elegir una URL personalizada (ej. /hub/villas-caribe).
                </p>
              </div>

              <div className="space-y-2">
                <Label>Mensaje de bienvenida</Label>
                <Textarea
                  value={draft.hubWelcomeMessage ?? ""}
                  onChange={(e) => update({ hubWelcomeMessage: e.target.value })}
                  placeholder="Bienvenido a Villas del Caribe. Reservá tu próxima escapada en menos de 2 minutos."
                  rows={3}
                  maxLength={500}
                />
                <p className="text-xs text-muted-foreground">
                  Hasta 500 caracteres. Aparece arriba de la lista de propiedades.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Logo del negocio (URL)</Label>
                <Input
                  value={draft.logoUrl ?? ""}
                  onChange={(e) => update({ logoUrl: e.target.value })}
                  placeholder="https://..."
                />
                <p className="text-xs text-muted-foreground">
                  Pegá una URL pública (ej. tu logo en Cloudinary o un CDN). Carga directa
                  desde tu computadora viene en una próxima versión.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <Button
                  onClick={() =>
                    save(
                      "hub",
                      {
                        hubWelcomeMessage: draft.hubWelcomeMessage,
                        logoUrl: draft.logoUrl,
                      },
                      setHubSave
                    )
                  }
                  disabled={
                    hubSave.kind === "saving" ||
                    (draft.hubWelcomeMessage === data.hubWelcomeMessage &&
                      draft.logoUrl === data.logoUrl)
                  }
                  className="gap-2"
                >
                  {hubSave.kind === "saving" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  Guardar Hub
                </Button>
                {hubSave.kind === "ok" && (
                  <span className="text-sm text-emerald-600">Guardado</span>
                )}
                {hubSave.kind === "err" && (
                  <span className="text-sm text-destructive">{hubSave.msg}</span>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── PAGOS ──────────────────────────────────────────────────── */}
        <TabsContent value="payments" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-primary" /> PayPal
                {paypalConfig.enabled && (
                  <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 ml-2">
                    Activo
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                El dinero va directo a tu PayPal. StayHost no procesa ni retiene pagos —
                solo orquesta la solicitud y registra el cobro.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {paypalLoading ? (
                <div className="flex items-center justify-center py-6 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" /> Cargando configuración...
                </div>
              ) : (
                <>
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-xs text-blue-900 space-y-2">
                    <p className="font-bold">Cómo obtener tus credenciales</p>
                    <ol className="list-decimal pl-4 space-y-1">
                      <li>Andá a <a href="https://developer.paypal.com/dashboard/applications" target="_blank" rel="noopener noreferrer" className="underline font-semibold">developer.paypal.com</a> y logueate con tu cuenta PayPal Business.</li>
                      <li>Crea una app (o abrí una existente). Empezá con <strong>Sandbox</strong> para probar; cuando esté todo OK pasás a <strong>Live</strong>.</li>
                      <li>Copiá <strong>Client ID</strong> y <strong>Secret</strong> y pegalos abajo.</li>
                    </ol>
                  </div>

                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Client ID</Label>
                      <Input
                        value={paypalConfig.clientId}
                        onChange={(e) => setPaypalConfig((p) => ({ ...p, clientId: e.target.value }))}
                        placeholder="AeC...x9"
                        className="font-mono text-xs"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Client Secret</Label>
                      <Input
                        type="password"
                        value={paypalConfig.clientSecret}
                        onChange={(e) => setPaypalConfig((p) => ({ ...p, clientSecret: e.target.value }))}
                        placeholder={paypalConfig.hasSecret ? `Guardado: ${paypalConfig.clientSecretMasked}` : "EBd...xQ"}
                        className="font-mono text-xs"
                      />
                      {paypalConfig.hasSecret && (
                        <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <Lock className="h-3 w-3" /> Dejalo vacío para mantener el actual
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Modo</Label>
                      <select
                        value={paypalConfig.mode}
                        onChange={(e) => setPaypalConfig((p) => ({ ...p, mode: e.target.value as "sandbox" | "live" }))}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      >
                        <option value="sandbox">Sandbox (pruebas)</option>
                        <option value="live">Live (cobros reales)</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label>Estado</Label>
                      <div className="flex items-center gap-3 h-10">
                        <input
                          type="checkbox"
                          id="paypalEnabled"
                          checked={paypalConfig.enabled}
                          onChange={(e) => setPaypalConfig((p) => ({ ...p, enabled: e.target.checked }))}
                          className="h-4 w-4"
                        />
                        <label htmlFor="paypalEnabled" className="text-sm font-medium select-none cursor-pointer">
                          Habilitar PayPal en mi Hub
                        </label>
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        Si está deshabilitado, el botón de pago no aparece en el Hub público.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 pt-2">
                    <Button onClick={savePaypal} disabled={paypalSave.kind === "saving"} className="gap-2">
                      {paypalSave.kind === "saving" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Guardar
                    </Button>
                    {paypalSave.kind === "ok" && <span className="text-sm text-emerald-600">Guardado</span>}
                    {paypalSave.kind === "err" && <span className="text-sm text-destructive">{paypalSave.msg}</span>}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="border-dashed">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-muted-foreground" />
                Otros métodos
                <Badge variant="secondary">Próximamente</Badge>
              </CardTitle>
              <CardDescription className="text-xs">
                Stripe Connect, MercadoPago y BHD León (transferencia manual) llegan en próximas versiones.
                Mientras tanto, podés coordinar el cobro por WhatsApp después de aprobar la solicitud.
              </CardDescription>
            </CardHeader>
          </Card>
        </TabsContent>

        {/* ─── ZONA PELIGRO ──────────────────────────────────────────── */}
        <TabsContent value="danger" className="space-y-4">
          <Card className="border-destructive/40 bg-destructive/5">
            <CardHeader>
              <CardTitle className="text-destructive flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                Eliminar mi cuenta
              </CardTitle>
              <CardDescription>
                Esta acción borra tu tenant, todas tus propiedades, reservas, miembros del equipo y
                datos asociados. <strong>No se puede deshacer.</strong>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>
                  Para confirmar, escribí <strong className="font-mono">ELIMINAR</strong> en el campo
                </Label>
                <Input
                  value={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.value)}
                  placeholder="ELIMINAR"
                  className="font-mono"
                />
              </div>
              <div className="flex items-center gap-3">
                <Button
                  variant="destructive"
                  disabled={deleteConfirm !== "ELIMINAR" || deleting}
                  onClick={deleteAccount}
                  className="gap-2"
                >
                  {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
                  Eliminar mi cuenta para siempre
                </Button>
                {deleteErr && <span className="text-sm text-destructive">{deleteErr}</span>}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

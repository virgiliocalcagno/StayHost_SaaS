"use client";

/**
 * TTLockAccountsSection — gestiona las cuentas TTLock del tenant.
 *
 * Lee/escribe via /api/ttlock/accounts. Un tenant puede tener N cuentas
 * TTLock conectadas (cada una agrupa cerraduras compradas bajo ese email).
 * No guardamos la contraseña: al conectar se canjea por access/refresh
 * token. Si el refresh falla (revocación / contraseña cambiada), la UI
 * pide reconectar pidiendo solo la contraseña otra vez.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  KeyRound, Plus, RefreshCw, Trash2, Lock, Battery,
  AlertCircle, Loader2, CheckCircle2, Link2,
} from "lucide-react";

type Account = {
  id: string;
  label: string;
  ttlock_username: string;
  token_expires_at: string | null;
  last_synced_at: string | null;
  created_at: string;
  expired: boolean;
};

type LockSummary = {
  lockId: string;
  name: string;
  battery: number | null;
};

type PropertyOption = { id: string; name: string };

async function api<T>(
  path: string,
  init?: RequestInit & { json?: unknown }
): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(path, {
    ...rest,
    credentials: "same-origin",
    headers: {
      ...(json ? { "Content-Type": "application/json" } : {}),
      ...(rest.headers ?? {}),
    },
    body: json ? JSON.stringify(json) : rest.body,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data;
}

export default function TTLockAccountsSection() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [loadingList, setLoadingList] = useState(false);

  // Lock lists keyed by accountId
  const [locksByAccount, setLocksByAccount] = useState<Record<string, LockSummary[]>>({});
  const [loadingLocks, setLoadingLocks] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Dialogs
  const [connectOpen, setConnectOpen] = useState(false);
  const [reconnectFor, setReconnectFor] = useState<Account | null>(null);

  // Per-lock → property assignment UI state
  const [assigning, setAssigning] = useState<string | null>(null); // lockId being assigned

  const refreshAccounts = useCallback(async () => {
    setLoadingList(true);
    try {
      const data = await api<{ accounts: Account[] }>("/api/ttlock/accounts");
      setAccounts(data.accounts ?? []);
    } catch (err) {
      console.error("[ttlock-accounts] refresh failed:", err);
    } finally {
      setLoadingList(false);
    }
  }, []);

  const refreshProperties = useCallback(async () => {
    try {
      const res = await fetch("/api/properties", { credentials: "same-origin" });
      if (!res.ok) return;
      const data = (await res.json()) as { properties?: Array<{ id: string; name: string }> };
      setProperties((data.properties ?? []).map((p) => ({ id: p.id, name: p.name })));
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => {
    refreshAccounts();
    refreshProperties();
  }, [refreshAccounts, refreshProperties]);

  const toggleExpanded = useCallback(
    async (acc: Account) => {
      const willOpen = !expanded[acc.id];
      setExpanded((e) => ({ ...e, [acc.id]: willOpen }));
      if (!willOpen || locksByAccount[acc.id]) return;
      // Fetch locks on first expand
      setLoadingLocks((s) => ({ ...s, [acc.id]: true }));
      try {
        const data = await api<{ locks: LockSummary[] }>("/api/ttlock/accounts", {
          method: "POST",
          json: { action: "listLocks", accountId: acc.id },
        });
        setLocksByAccount((m) => ({ ...m, [acc.id]: data.locks }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("TOKEN_EXPIRED")) {
          setReconnectFor(acc);
        } else {
          alert(`Error listando cerraduras: ${msg}`);
        }
      } finally {
        setLoadingLocks((s) => ({ ...s, [acc.id]: false }));
      }
    },
    [expanded, locksByAccount]
  );

  const deleteAccount = useCallback(
    async (acc: Account) => {
      if (!confirm(`¿Eliminar la cuenta "${acc.label}"?`)) return;
      try {
        await api(`/api/ttlock/accounts?id=${acc.id}`, { method: "DELETE" });
        setAccounts((list) => list.filter((a) => a.id !== acc.id));
      } catch (err) {
        alert(`Error: ${err instanceof Error ? err.message : err}`);
      }
    },
    []
  );

  const assignLockToProperty = useCallback(
    async (accountId: string, lockId: string, propertyId: string) => {
      setAssigning(lockId);
      try {
        // Simple PATCH via the properties endpoint would be cleaner — for
        // now piggy-back on /api/properties/sync with an action flag. We'll
        // create a dedicated PATCH later if this grows.
        const res = await fetch("/api/properties", {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            propertyId,
            ttlock_lock_id: lockId,
            ttlock_account_id: accountId,
          }),
        });
        if (!res.ok) {
          const msg = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(msg.error ?? `HTTP ${res.status}`);
        }
        alert("Cerradura asignada a la propiedad");
      } catch (err) {
        alert(`No se pudo asignar: ${err instanceof Error ? err.message : err}`);
      } finally {
        setAssigning(null);
      }
    },
    []
  );

  return (
    <Card className="mb-4">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4 text-primary" />
            Cuentas TTLock conectadas
          </CardTitle>
          <CardDescription>
            Cada cuenta agrupa las cerraduras compradas bajo un mismo email.
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={refreshAccounts}
            disabled={loadingList}
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${loadingList ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
          <Button size="sm" onClick={() => setConnectOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Conectar cuenta
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-2">
        {accounts.length === 0 && !loadingList && (
          <div className="text-sm text-muted-foreground py-8 text-center border border-dashed rounded-lg">
            No hay cuentas TTLock conectadas. Conecta una para ver tus cerraduras.
          </div>
        )}

        {accounts.map((acc) => {
          const isOpen = !!expanded[acc.id];
          const locks = locksByAccount[acc.id];
          const loadingThese = !!loadingLocks[acc.id];
          return (
            <div key={acc.id} className="rounded-lg border">
              <div className="flex items-center justify-between p-3">
                <button
                  className="flex-1 text-left flex items-center gap-3"
                  onClick={() => toggleExpanded(acc)}
                >
                  <div
                    className={`h-8 w-8 rounded-md flex items-center justify-center ${
                      acc.expired ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
                    }`}
                  >
                    {acc.expired ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium">{acc.label}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {acc.ttlock_username}
                    </div>
                  </div>
                </button>
                <div className="flex items-center gap-2">
                  {acc.expired ? (
                    <Badge variant="outline" className="text-amber-700 border-amber-300">
                      Reconectar
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-emerald-700 border-emerald-300">
                      Conectada
                    </Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setReconnectFor(acc)}
                    title="Reconectar"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteAccount(acc)}
                    title="Eliminar"
                  >
                    <Trash2 className="h-4 w-4 text-red-600" />
                  </Button>
                </div>
              </div>

              {isOpen && (
                <div className="border-t px-3 py-3 bg-muted/30 space-y-2">
                  {loadingThese && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Cargando cerraduras...
                    </div>
                  )}
                  {!loadingThese && locks && locks.length === 0 && (
                    <div className="text-sm text-muted-foreground">
                      No hay cerraduras en esta cuenta.
                    </div>
                  )}
                  {!loadingThese &&
                    locks?.map((lock) => (
                      <LockRow
                        key={lock.lockId}
                        accountId={acc.id}
                        lock={lock}
                        properties={properties}
                        assigning={assigning === lock.lockId}
                        onAssign={(propertyId) =>
                          assignLockToProperty(acc.id, lock.lockId, propertyId)
                        }
                      />
                    ))}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>

      <ConnectAccountDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        onSuccess={() => {
          setConnectOpen(false);
          refreshAccounts();
        }}
      />

      <ReconnectDialog
        account={reconnectFor}
        onOpenChange={(open) => !open && setReconnectFor(null)}
        onSuccess={(id) => {
          setReconnectFor(null);
          setExpanded((e) => ({ ...e, [id]: false }));
          setLocksByAccount((m) => {
            const { [id]: _removed, ...rest } = m;
            return rest;
          });
          refreshAccounts();
        }}
      />
    </Card>
  );
}

// ─── Lock row with property assignment ─────────────────────────────────────

function LockRow({
  lock,
  properties,
  assigning,
  onAssign,
}: {
  accountId: string;
  lock: LockSummary;
  properties: PropertyOption[];
  assigning: boolean;
  onAssign: (propertyId: string) => void;
}) {
  const [selected, setSelected] = useState<string>("");
  return (
    <div className="flex items-center gap-3 rounded-md border bg-background p-2">
      <div className="h-8 w-8 rounded-md bg-primary/10 text-primary flex items-center justify-center">
        <Lock className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-medium text-sm truncate">{lock.name}</div>
        <div className="text-xs text-muted-foreground flex items-center gap-2">
          <span>ID: {lock.lockId}</span>
          {lock.battery !== null && (
            <span className="inline-flex items-center gap-1">
              <Battery className="h-3 w-3" />
              {lock.battery}%
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Select value={selected} onValueChange={setSelected}>
          <SelectTrigger className="w-48 h-8 text-xs">
            <SelectValue placeholder="Asignar a propiedad..." />
          </SelectTrigger>
          <SelectContent>
            {properties.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          disabled={!selected || assigning}
          onClick={() => selected && onAssign(selected)}
        >
          {assigning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />}
        </Button>
      </div>
    </div>
  );
}

// ─── Connect new account dialog ────────────────────────────────────────────

function ConnectAccountDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSuccess: () => void;
}) {
  const [label, setLabel] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      setLabel("");
      setUsername("");
      setPassword("");
      setError("");
      setLoading(false);
    }
  }, [open]);

  const submit = async () => {
    setError("");
    setLoading(true);
    try {
      await api("/api/ttlock/accounts", {
        method: "POST",
        json: { action: "connect", label, username, password },
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const valid = label.trim().length > 0 && username.trim().length > 0 && password.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Conectar cuenta TTLock</DialogTitle>
          <DialogDescription>
            Usa el email y contraseña de tu app TTLock. La contraseña solo se
            usa una vez para obtener un token — no queda guardada.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label htmlFor="ttlock-label">Nombre (interno)</Label>
            <Input
              id="ttlock-label"
              placeholder="Casa playa"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ttlock-user">Email TTLock</Label>
            <Input
              id="ttlock-user"
              type="email"
              autoComplete="off"
              placeholder="tu@email.com"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ttlock-pass">Contraseña</Label>
            <Input
              id="ttlock-pass"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-2">
              {error}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={!valid || loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Conectar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Reconnect (refresh expired token) ─────────────────────────────────────

function ReconnectDialog({
  account,
  onOpenChange,
  onSuccess,
}: {
  account: Account | null;
  onOpenChange: (v: boolean) => void;
  onSuccess: (accountId: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!account) {
      setPassword("");
      setError("");
      setLoading(false);
    }
  }, [account]);

  const submit = async () => {
    if (!account) return;
    setError("");
    setLoading(true);
    try {
      await api("/api/ttlock/accounts", {
        method: "POST",
        json: { action: "reconnect", accountId: account.id, password },
      });
      onSuccess(account.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={!!account} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reconectar cuenta</DialogTitle>
          <DialogDescription>
            Introduce la contraseña de {account?.ttlock_username} para renovar
            el acceso.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Input
            type="password"
            autoComplete="new-password"
            placeholder="Contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-2">
              {error}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={!password || loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Reconectar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

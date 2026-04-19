# StayHost — Refactor Smart Devices (Fase 1 + 2)

Fecha: 2026-04-19
Rama de trabajo: `main` (o la activa de Virgilio)
Autor del refactor: Virgilio + Claude

Este documento resume el refactor completo del módulo **Smart Devices** del panel StayHost (Next.js 15 + Supabase). Sirve como contexto para futuras sesiones o para alimentar NotebookLM.

---

## 1. Problema original

El panel `SmartDevicesPanel.tsx` (~1.200 líneas en un solo archivo) estaba:

- **Guardando todo en `localStorage`**: dispositivos, PINs, feeds iCal e incluso credenciales de TTLock/Tuya.
- Sin sincronización entre dispositivos/sesiones.
- Sin forma de que el servidor conozca PINs activos para invalidarlos cuando llega un webhook de TTLock.
- Los PINs no estaban relacionados con las reservas reales.
- La tabla `Dispositivos / Llaves & PINs / iCal & Acceso` mostraba datos cacheados que no reflejaban la DB.

## 2. Objetivos

1. Partir el monolito en componentes por responsabilidad.
2. Mover **toda** la persistencia a Supabase, con RLS por `tenant_id`.
3. Rehacer los tres tabs principales para que lean/escriban contra la DB.
4. Mantener TTLock multi-cuenta (una cuenta por "propiedad-edificio", N por tenant).
5. Nunca exponer tokens de TTLock al cliente — todas las acciones sensibles pasan por un endpoint del servidor que resuelve el token.

## 3. Cambios por fase

### Fase 1 — split de `SmartDevicesPanel.tsx`

Extraídos a `src/components/dashboard/smart-devices/`:

- `types.ts` — shared `DeviceType`, `SmartDevice`, `AccessPin`, `ICalConfig`, `Integrations`, `Property`.
- `utils.ts` — `DEVICE_ICONS`, `DEVICE_LABELS`, `CHANNEL_LABELS`, `CHANNEL_COLORS`, `batteryColor`, `formatDate`, `formatDateTime`, `isExpiredPin`.
- `TTLockAccountsSection.tsx` — UI para gestionar cuentas TTLock del tenant (conectar, reconectar, listar cerraduras, asignar a propiedades).
- `ImportWizardDialog.tsx` — modal para importar dispositivos desde app Tuya/TTLock (creds se quedan en el wizard).

### Fase 2a — Config tab sobre Supabase

- Se eliminó el formulario legacy de credenciales TTLock/Tuya en Config.
- Config ahora muestra `<TTLockAccountsSection />` + info de env vars + botón "Limpiar caché local".
- `stayhost_integrations` de localStorage sólo queda para el Import Wizard.

### Fase 2b — Tabs conectados a Supabase

Los tres tabs (`devices`, `pins`, `ical`) dejaron de usar localStorage:

- **Dispositivos**: se deriva de `properties[]` filtrando las que tienen `ttlock_lock_id`. Batería/online viene de `listLocks` por cada cuenta TTLock.
- **Llaves & PINs**: lista desde `/api/access-pins`, CRUD contra el mismo endpoint. Si la propiedad tiene cuenta+cerradura, al crear/revocar un PIN también se programa/borra en TTLock.
- **iCal & Acceso**: deriva los feeds de `properties.ical_airbnb` y `properties.ical_vrbo`. Agregar = `PATCH /api/properties`. Sincronizar = `POST /api/ical/import`.

---

## 4. Schema nuevo

### `supabase/migrations/20260419_access_pins.sql`

```sql
create table if not exists public.access_pins (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  property_id    uuid not null references public.properties(id) on delete cascade,
  booking_id     uuid references public.bookings(id) on delete set null,
  ttlock_lock_id text,
  ttlock_pwd_id  text,
  guest_name     text not null,
  guest_phone    text,
  pin            text not null,
  source         text not null default 'manual'
                 check (source in ('manual','airbnb_ical','vrbo_ical','direct_booking')),
  status         text not null default 'active'
                 check (status in ('active','expired','revoked')),
  valid_from     timestamptz not null,
  valid_to       timestamptz not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint access_pins_dates_chk check (valid_to > valid_from)
);
```

Con índices en `(tenant_id, created_at desc)`, `(property_id, status)`, `(booking_id)`. Trigger `touch_updated_at`. RLS completo (select/insert/update/delete) scoped a `public.current_tenant_id()`.

### Otras tablas relevantes

- `ttlock_accounts` (ya existía) — N cuentas TTLock por tenant. Guarda `access_token`, `refresh_token`, `token_expires_at`.
- `properties` — columnas usadas: `ttlock_lock_id`, `ttlock_account_id`, `ical_airbnb`, `ical_vrbo`.
- `bookings` — columnas: `property_id`, `source_uid`, `source`, `guest_name`, `guest_phone`, `check_in`, `check_out`, `status`, `booking_url`. Índice único `(property_id, source_uid)` para upsert idempotente.

---

## 5. API endpoints

Todos usan `getAuthenticatedTenant()` y dependen de RLS para filtrar por tenant.

### `GET/POST/PATCH/DELETE /api/access-pins`

- **GET** → devuelve todos los PINs del tenant, joined con el nombre de la propiedad.
- **POST** `{ propertyId, guestName, pin, validFrom, validTo, guestPhone?, bookingId?, ttlockLockId?, ttlockPwdId?, source? }` → crea un PIN. Valida `pin` 4-8 dígitos, `validTo > validFrom`, `source` en whitelist.
- **PATCH** `{ id, ...patch }` → allowed: `status, valid_from, valid_to, ttlock_pwd_id, pin, guest_name, guest_phone`.
- **DELETE** `?id=xxx`.

### `POST /api/ttlock/accounts` — acciones extendidas

Además de `connect`, `reconnect`, `rename`, `listLocks`, ahora:

- `unlock { accountId, lockId }` — resuelve el token del accountId (refresh si hace falta) y llama `/v3/lock/unlock`.
- `createPin { accountId, lockId, pin, startDate, endDate, name? }` — programa el PIN en la cerradura. Devuelve `keyboardPwdId`.
- `deletePin { accountId, lockId, keyboardPwdId }` — borra el PIN.

Los tokens de TTLock **nunca** salen del servidor.

### `PATCH /api/properties`

`ALLOWED_FIELDS` extendido a: `ttlock_lock_id`, `ttlock_account_id`, `ical_airbnb`, `ical_vrbo`. Body: `{ propertyId, ...patch }`.

### `POST /api/ical/import`

Body: `{ propertyId }`. Lee `ical_airbnb` y `ical_vrbo` de la propiedad, hace fetch a cada URL, parsea los VEVENT y upsert en `bookings` por `(property_id, source_uid)`.

**Fix del 2026-04-19 sobre el parser de URL**: Airbnb mete en `DESCRIPTION` cosas como `URL: https://.../HM4CZADMNT\nPhone Number (Last 4 Digits): 8822`. El regex ahora:

1. Corta en whitespace, backslash, coma, `<`, `>`, `"`.
2. Si es URL de Airbnb reservation, trunca en el código de reserva (10+ alfanuméricos).
3. Guard final limpia `\n` o `/n` + mayúscula residual.

Aguanta subdominios `www.`, `es.`, `m.` y sin subdominio.

---

## 6. Flujo de datos (Fase 2b)

```
┌─────────────────┐
│  SmartDevices   │
│     Panel       │
└────────┬────────┘
         │ useEffect al montar
         ▼
    ┌────────────────────────────────────────┐
    │ refreshAll()                            │
    │  ├─ GET /api/properties                 │
    │  ├─ GET /api/access-pins                │
    │  └─ GET /api/ttlock/accounts            │
    │      └─ POST listLocks por cada account │
    └────────────────────────────────────────┘
         │
         ▼
    properties[], pins[], accounts[], liveLocks{}
         │
         ├─ devices = properties.filter(ttlock_lock_id).map(…)
         ├─ icalConfigs = properties.flatMap(ical_airbnb, ical_vrbo)
         ├─ online/offline/lowBattery/activePins = derivados
         │
         └─ Render según activeTab
```

Mutaciones:

- **Abrir cerradura remoto** → `POST /api/ttlock/accounts { action: unlock, accountId, lockId }`.
- **Crear PIN** → `POST /api/access-pins` + (si hay cuenta) `POST /api/ttlock/accounts { action: createPin }`.
- **Revocar PIN** → `PATCH /api/access-pins { id, status: revoked }` + `deletePin` en TTLock si aplica.
- **Eliminar PIN** → `DELETE /api/access-pins?id=…` + `deletePin` en TTLock si aplica.
- **Agregar iCal** → `PATCH /api/properties { propertyId, ical_airbnb o ical_vrbo }`.
- **Quitar iCal** → `PATCH /api/properties { propertyId, ical_airbnb: null }`.
- **Sincronizar iCal** → `POST /api/ical/import { propertyId }`.

---

## 7. localStorage residual

Sólo queda `stayhost_integrations` para el Import Wizard (legacy). Todo lo demás (`stayhost_smart_devices`, `stayhost_pins`, `stayhost_ical_configs`) se limpió con el botón "Limpiar caché local" en Config.

---

## 8. Problemas abiertos / pendientes

- **Toggle auto-generación de PINs desde iCal**: el server-side `/api/ical/import` crea `bookings`, pero no crea PINs automáticamente todavía. Para hacerlo hay que: al insertar una `booking` con `guest_phone != null`, generar un registro en `access_pins` con `source = airbnb_ical | vrbo_ical`, `pin = last4(phone)`, y opcionalmente programar TTLock si `properties.ttlock_account_id` y `properties.ttlock_lock_id` están presentes.
- **Limpieza de URLs sucias en `bookings`**: las reservas insertadas antes del fix tienen `booking_url` con basura (`/nPhone…`). Se limpian solas al re-sincronizar (upsert sobreescribe).
- **Feed "Booking.com" y "other"**: se eliminaron del selector de canal en el form de iCal porque `properties` sólo tiene columnas `ical_airbnb` y `ical_vrbo`. Si se quiere soportar Booking, hay que agregar columna o generalizar.
- **Import Wizard**: los dispositivos importados vía wizard no persisten en DB — quedan en memoria hasta la próxima carga. Para que sean permanentes hay que hacerle que PATCH la propiedad con `ttlock_lock_id`.

---

## 9. Cómo verificar en producción

1. Aplicar migración `20260419_access_pins.sql` (vía SQL Editor de Supabase).
2. Confirmar que la tabla existe con 4 índices y 4 políticas RLS:
   ```sql
   select indexname from pg_indexes
   where schemaname = 'public' and tablename = 'access_pins';
   ```
3. Entrar al panel Dispositivos → Llaves & PINs → Crear PIN manual → recargar → debe seguir ahí.
4. En iCal: agregar feed → Sincronizar → verificar en `bookings` que `booking_url` quede limpio (sin `/nPhone…`).
5. Abrir cerradura remoto: pestaña Dispositivos → botón "Abrir". Solo funciona si la cerradura tiene gateway/WiFi (`errcode -2012` significa "no gateway").

---

## 10. Stack

- Next.js 15 App Router (route handlers en `src/app/api/**/route.ts`)
- Supabase (Postgres + Auth + RLS)
- `@supabase/ssr` con cookies para sesión server-side
- TTLock Open Platform v3 (`/v3/lock/*`, `/v3/keyboardPwd/*`, `/oauth2/token`)
- Despliegue: Netlify (o Vercel — el código soporta ambos via env vars)
- Frontend: React 19, Tailwind, shadcn/ui

## 11. Contexto del proyecto

StayHost es una herramienta de gestión para rentas cortas multi-tenant que integra:

- **TTLock** (cerraduras inteligentes, PINs por reserva)
- **Tuya** (sensores, termostatos)
- **iCal Airbnb / VRBO** (sincronización de reservas)
- **Reservas directas** (checkout propio)

Virgilio es owner/dev del proyecto. Zona horaria: Chile continental (UTC-4). Trabaja en español.

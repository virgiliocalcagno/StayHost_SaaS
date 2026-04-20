-- ============================================================================
-- StayHost — ticket_events: help desk timeline (event sourcing)
-- Date: 2026-04-20
--
-- Why:
--   Un ticket de mantenimiento necesita historial completo: quién reportó,
--   quién lo asignó, cuándo se envió WhatsApp, qué respondió el proveedor,
--   qué notas internas hay. Guardarlo todo en columnas de maintenance_tickets
--   es imposible (multivalor). Event sourcing: cada acción genera un evento
--   inmutable y la UI reconstruye el timeline.
--
--   Además expandimos el check constraint de status para soportar un ciclo
--   de vida más rico (esperando_respuesta, confirmado, etc.) además de los
--   4 originales.
-- ============================================================================

-- 1) Ampliar estados del ticket. Los valores antiguos (open/in_progress/
-- resolved/dismissed) siguen siendo válidos para no romper datos existentes.
alter table public.maintenance_tickets
  drop constraint if exists maintenance_tickets_status_check;

alter table public.maintenance_tickets
  add constraint maintenance_tickets_status_check
  check (status in (
    'open',                     -- abierto, recién reportado
    'awaiting_response',        -- se envió WhatsApp al proveedor, no contestó
    'confirmed',                -- proveedor confirmó que va
    'in_progress',              -- trabajando (en camino o en sitio)
    'pending_verification',     -- proveedor marcó listo, admin debe verificar
    'resolved',                 -- verificado por admin
    'invoiced',                 -- facturado / pagado al proveedor
    'closed',                   -- cerrado definitivo
    'dismissed'                 -- descartado (falsa alarma)
  ));

-- 2) Tabla de eventos del ticket — event sourcing.
create table if not exists public.ticket_events (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  ticket_id     uuid not null references public.maintenance_tickets(id) on delete cascade,

  -- Tipo del evento. La UI renderiza cada uno con estilo distinto:
  --   status_change      — sistema, gris centrado
  --   assignment         — sistema, gris centrado
  --   whatsapp_sent      — burbuja verde (derecha, mensaje saliente)
  --   whatsapp_received  — burbuja blanca (izquierda, respuesta proveedor)
  --   internal_note      — burbuja amarilla, solo equipo interno
  --   photo_request      — acción rápida enviada al proveedor
  --   escalation         — escalado a supervisor
  --   attachment         — foto o archivo subido
  event_type    text not null check (event_type in (
    'status_change', 'assignment', 'whatsapp_sent', 'whatsapp_received',
    'internal_note', 'photo_request', 'escalation', 'attachment', 'created'
  )),

  -- Contenido visible. Para mensajes es el texto; para status_change es la
  -- descripción amigable generada por el backend (ej. "Pasó de abierto a
  -- esperando respuesta"). Nullable para eventos como 'attachment'.
  content       text,

  -- Quién generó el evento. Puede ser un team_member, o null si es respuesta
  -- externa (ej. whatsapp_received cuando el proveedor responde — el nombre
  -- se guarda desnormalizado en actor_name).
  actor_id      uuid,
  actor_name    text,

  -- Metadata libre para extensibilidad:
  --   status_change:   { "from": "open", "to": "awaiting_response" }
  --   assignment:      { "vendor_id": "...", "vendor_name": "...", "vendor_phone": "..." }
  --   whatsapp_sent:   { "phone": "+18091234567", "delivery_status": "sent" | "delivered" | "read" }
  --   attachment:      { "urls": ["https://..."] }
  metadata      jsonb not null default '{}'::jsonb,

  created_at    timestamptz not null default now()
);

create index if not exists ticket_events_ticket_idx
  on public.ticket_events (ticket_id, created_at asc);

create index if not exists ticket_events_tenant_idx
  on public.ticket_events (tenant_id, created_at desc);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.ticket_events enable row level security;

drop policy if exists ticket_events_select_own on public.ticket_events;
create policy ticket_events_select_own on public.ticket_events
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists ticket_events_insert_own on public.ticket_events;
create policy ticket_events_insert_own on public.ticket_events
  for insert to authenticated
  with check (tenant_id = public.current_tenant_id());

-- Eventos son inmutables — no update ni delete desde la app. Si un operador
-- se equivoca, agrega un nuevo evento tipo 'internal_note' corrigiendo.
-- (Admin SQL con service_role siempre puede limpiar si hiciera falta.)

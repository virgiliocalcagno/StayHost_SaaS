-- ============================================================================
-- StayHost — Reclamar órdenes pre-registro con OTP por email
-- Date: 2026-06-05
--
-- Caso de uso:
--   Huésped compra como guest checkout con email A (sin loguearse).
--   Después crea cuenta con email B (otro distinto). Sus órdenes con
--   email A quedan huérfanas (guest_auth_user_id IS NULL).
--   El endpoint /api/guest/claim-orders manda OTP al email A, el huésped
--   lo verifica desde su sesión actual (email B) y reclamamos las órdenes
--   asociando guest_auth_user_id = user actual.
--
-- Seguridad:
--   - Code hash, no plain. Solo el hash en BD.
--   - Expiración 30 min.
--   - Max 5 intentos por code (atomic increment).
--   - Solo reclamamos órdenes con guest_auth_user_id IS NULL para evitar
--     que un atacante use el flow para robar órdenes ya asociadas.
-- ============================================================================

create table if not exists public.guest_claim_codes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  email         text not null,
  code_hash     text not null,
  expires_at    timestamptz not null,
  attempts      int not null default 0,
  used_at       timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists guest_claim_codes_user_email_idx
  on public.guest_claim_codes (user_id, lower(email));

create index if not exists guest_claim_codes_expires_idx
  on public.guest_claim_codes (expires_at) where used_at is null;

-- RLS: solo el user dueño puede leer SUS codes. Las escrituras pasan por
-- el endpoint con supabaseAdmin — RLS es defensa en profundidad.
alter table public.guest_claim_codes enable row level security;

drop policy if exists guest_claim_codes_select_own on public.guest_claim_codes;
create policy guest_claim_codes_select_own
  on public.guest_claim_codes
  for select using (user_id = auth.uid());

comment on table public.guest_claim_codes is
  'OTPs para que un huésped logueado reclame órdenes pre-registro hechas con otro email. Code hashed; expiración 30min; max 5 attempts. Solo reclama órdenes con guest_auth_user_id IS NULL.';

-- ── Función atómica para increment de attempts (anti race condition) ────────
-- SELECT+UPDATE desde el cliente no es atómico; dos requests paralelos
-- podrían bypasear max_attempts. Esta RPC hace el increment con guard
-- en una sola query: si ya está agotado/vencido/usado, retorna NULL.
create or replace function public.increment_claim_attempts(
  p_code_id uuid,
  p_max_attempts int
)
returns int
language sql
security definer
as $$
  update public.guest_claim_codes
  set attempts = attempts + 1
  where id = p_code_id
    and attempts < p_max_attempts
    and used_at is null
    and expires_at > now()
  returning attempts;
$$;

comment on function public.increment_claim_attempts is
  'Increment atómico de attempts del OTP. Devuelve new attempts o NULL si el code está agotado/vencido/usado.';

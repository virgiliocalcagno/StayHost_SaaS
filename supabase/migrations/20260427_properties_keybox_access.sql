-- ============================================================================
-- StayHost — acceso físico (caja de llaves) en properties
-- Date: 2026-04-27
--
-- Para propiedades sin cerradura inteligente TTLock, el host necesita guardar:
--   - access_method     : método principal de acceso (ttlock | keybox | in_person | doorman)
--   - keybox_code       : código de la caja física
--   - keybox_location   : descripción de dónde está la caja ("jardín derecho, debajo de la maceta de helecho")
--   - keybox_photo_url  : foto de la ubicación de la caja (opcional)
--
-- El owner luego dispara un mensaje de WhatsApp pre-armado a la limpiadora o
-- al huésped con la dirección + instrucciones de acceso según el método.
--
-- TTLock convive: una propiedad con TTLock puede igual tener una caja física
-- como respaldo. access_method elige el principal.
--
-- Idempotente.
-- ============================================================================

alter table public.properties
  add column if not exists access_method text not null default 'in_person',
  add column if not exists keybox_code text,
  add column if not exists keybox_location text,
  add column if not exists keybox_photo_url text;

-- Restringir valores permitidos
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'properties_access_method_check'
  ) then
    alter table public.properties
      add constraint properties_access_method_check
      check (access_method in ('ttlock', 'keybox', 'in_person', 'doorman'));
  end if;
end$$;

-- Las propiedades que ya tienen TTLock vinculado arrancan con access_method='ttlock'
update public.properties
set access_method = 'ttlock'
where ttlock_lock_id is not null
  and access_method = 'in_person';

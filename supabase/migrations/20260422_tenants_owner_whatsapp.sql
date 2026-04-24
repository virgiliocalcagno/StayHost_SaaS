-- Agregar WhatsApp del owner al tenant para que el huesped pueda contactarlo
-- directo desde la pantalla de Sala de Espera del check-in v3.
alter table public.tenants
  add column if not exists owner_whatsapp text;

-- Comentario util para quien mire el schema:
comment on column public.tenants.owner_whatsapp is
  'Numero de WhatsApp del owner en formato E.164 (ej +18092585009). Lo usa el huesped en la pantalla de sala de espera para pedir autorizacion manual.';

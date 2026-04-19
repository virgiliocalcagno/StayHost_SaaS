-- ============================================================================
-- StayHost — access_pins.delivery_status: estado de entrega del código
-- Date: 2026-04-19
--
-- Why:
--   El panel "Llaves" (KeysPanel) tenía su propio estado en localStorage
--   (`stayhost_key_statuses`) con 3 valores: pending / sent / confirmed.
--   Al unificar "Llaves" con "Dispositivos > Llaves & PINs" (ambos escriben
--   en access_pins), el estado de entrega necesita vivir junto al PIN en el
--   DB para que se vea igual en los dos paneles y sobreviva un clear-cache.
--
--   No usamos `status` porque ya significa el estado del PIN técnico en la
--   cerradura (active / expired / revoked). Son dos dimensiones distintas:
--     - status         = ¿la cerradura acepta este código?
--     - delivery_status = ¿ya le avisé al huésped?
-- ============================================================================

alter table public.access_pins
  add column if not exists delivery_status text not null default 'pending'
    check (delivery_status in ('pending', 'sent', 'confirmed'));

-- Índice parcial para buscar rápido los PINs por reserva desde KeysPanel.
create index if not exists access_pins_booking_delivery_idx
  on public.access_pins (booking_id, delivery_status)
  where booking_id is not null;

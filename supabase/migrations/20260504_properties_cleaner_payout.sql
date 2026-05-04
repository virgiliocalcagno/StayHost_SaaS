-- Sprint C-MVP: monto que se le paga al cleaner por una limpieza terminada
-- en cada propiedad. Distinto del cleaning_fee_one_day/more_days que cobra al
-- huésped — eso es ingreso del owner, esto es egreso al staff.

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS cleaner_payout numeric(10,2);

COMMENT ON COLUMN public.properties.cleaner_payout IS
  'Pago al cleaner por limpieza completada. NULL = no configurado (la wallet del cleaner mostrará "—" para esa tarea).';

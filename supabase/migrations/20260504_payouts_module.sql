-- Sprint C — Pagos y liquidación
-- Fuente de verdad: docs/modulo-limpieza-modelo-canonico.md §pagos
-- y memoria project_modulo_pagos.md
--
-- Decisiones cerradas:
--  · admin genera cortes; supervisor read-only de su equipo; cleaner
--    contractor ve solo lo suyo; cleaner employee no tiene acceso.
--  · pago off-platform (efectivo / transferencia / paypal); el SaaS solo
--    registra el evento.
--  · una tarea no se liquida dos veces para el mismo rol (UNIQUE constraint).
--
-- Nota: cleaning_tasks.id es text en este schema, por eso el FK también lo es.

CREATE TABLE IF NOT EXISTS public.payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.team_members(id) ON DELETE RESTRICT,
  period_start date NOT NULL,
  period_end date NOT NULL,
  total_amount numeric(10,2) NOT NULL CHECK (total_amount >= 0),
  currency text NOT NULL DEFAULT 'DOP',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','cancelled')),
  payment_method text CHECK (payment_method IN ('cash','transfer','paypal','other') OR payment_method IS NULL),
  reference text,
  paid_at timestamptz,
  paid_by uuid REFERENCES public.team_members(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payouts_period_valid CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS payouts_tenant_idx ON public.payouts(tenant_id);
CREATE INDEX IF NOT EXISTS payouts_member_idx ON public.payouts(member_id);
CREATE INDEX IF NOT EXISTS payouts_status_idx ON public.payouts(status) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.payout_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_id uuid NOT NULL REFERENCES public.payouts(id) ON DELETE CASCADE,
  cleaning_task_id text NOT NULL REFERENCES public.cleaning_tasks(id) ON DELETE RESTRICT,
  amount numeric(10,2) NOT NULL CHECK (amount >= 0),
  role text NOT NULL CHECK (role IN ('cleaner','supervisor')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cleaning_task_id, role)
);

CREATE INDEX IF NOT EXISTS payout_items_payout_idx ON public.payout_items(payout_id);
CREATE INDEX IF NOT EXISTS payout_items_task_idx ON public.payout_items(cleaning_task_id);

CREATE OR REPLACE FUNCTION public.payouts_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payouts_updated_at ON public.payouts;
CREATE TRIGGER payouts_updated_at
  BEFORE UPDATE ON public.payouts
  FOR EACH ROW EXECUTE FUNCTION public.payouts_set_updated_at();

ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payouts_tenant_select ON public.payouts;
CREATE POLICY payouts_tenant_select ON public.payouts
  FOR SELECT USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS payouts_tenant_insert ON public.payouts;
CREATE POLICY payouts_tenant_insert ON public.payouts
  FOR INSERT WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS payouts_tenant_update ON public.payouts;
CREATE POLICY payouts_tenant_update ON public.payouts
  FOR UPDATE USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS payouts_tenant_delete ON public.payouts;
CREATE POLICY payouts_tenant_delete ON public.payouts
  FOR DELETE USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS payout_items_via_payout_select ON public.payout_items;
CREATE POLICY payout_items_via_payout_select ON public.payout_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.payouts p
      WHERE p.id = payout_items.payout_id
        AND p.tenant_id = public.current_tenant_id()
    )
  );

DROP POLICY IF EXISTS payout_items_via_payout_insert ON public.payout_items;
CREATE POLICY payout_items_via_payout_insert ON public.payout_items
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.payouts p
      WHERE p.id = payout_items.payout_id
        AND p.tenant_id = public.current_tenant_id()
    )
  );

DROP POLICY IF EXISTS payout_items_via_payout_delete ON public.payout_items;
CREATE POLICY payout_items_via_payout_delete ON public.payout_items
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.payouts p
      WHERE p.id = payout_items.payout_id
        AND p.tenant_id = public.current_tenant_id()
    )
  );

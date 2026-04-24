-- ============================================================================
-- StayHost — checkin_records v3: datos de contacto + OCR + audit trail
-- Date: 2026-04-22
--
-- El flow v3 (PR #10) redisena el Paso 2 para capturar de una sola pantalla:
-- foto ID + OCR + email + whatsapp + acompañantes. Necesitamos columnas
-- nuevas para persistir todo.
--
-- Todo `add column if not exists` para idempotencia.
-- ============================================================================

alter table public.checkin_records
  -- Datos de contacto (el telefono ya esta en last_four_digits vs phone)
  add column if not exists guest_email text,
  add column if not exists guest_whatsapp text,
  add column if not exists guest_count integer default 1,

  -- OCR extraido del documento
  add column if not exists ocr_raw jsonb,              -- respuesta cruda de Gemini
  add column if not exists ocr_name text,              -- nombre extraido
  add column if not exists ocr_document text,          -- numero documento extraido
  add column if not exists ocr_nationality text,       -- ISO-3 code
  add column if not exists ocr_language text,          -- ISO-1 code
  add column if not exists ocr_confidence numeric(3,2), -- 0.00-1.00
  add column if not exists ocr_attempts integer default 0,

  -- Flags para Sala de Espera / autorizaciones manuales
  add column if not exists requires_manual_review boolean default false,
  add column if not exists waiting_for_auth boolean default false,
  add column if not exists auth_reason text,           -- "ocr_failed" | "electricity_pending" | null

  -- Audit trail
  add column if not exists ip_address text,
  add column if not exists user_agent text,
  add column if not exists consent_accepted_at timestamptz;

-- Indices para busquedas comunes del dashboard
create index if not exists checkin_records_waiting_idx
  on public.checkin_records (tenant_id, waiting_for_auth)
  where waiting_for_auth = true;

create index if not exists checkin_records_guest_email_idx
  on public.checkin_records (guest_email)
  where guest_email is not null;

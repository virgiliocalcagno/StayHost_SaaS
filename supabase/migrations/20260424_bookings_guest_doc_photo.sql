-- ============================================================================
-- StayHost — bookings.guest_doc_photo_path: foto del ID escaneada por el host
-- Date: 2026-04-24
--
-- Why:
--   DocumentScanButton en el dashboard escanea el ID/pasaporte del huésped
--   al crear una reserva directa. Hasta ahora sólo persistíamos los DATOS
--   extraídos (bookings.guest_doc, guest_nationality), pero descartábamos la
--   imagen. Resultado: cuando el huésped entra al check-in, le volvemos a
--   pedir la foto — inconsistencia operativa que el owner detectó en prod.
--
--   Con esta columna el API de OCR sube la imagen al bucket `checkin-ids`
--   y guarda el path acá. El lookup del huésped hereda id_photo_path al
--   checkin_record y marca id_status='validated', saltando el Paso 2 del
--   upload de foto.
--
-- Idempotente.
-- ============================================================================

alter table public.bookings
  add column if not exists guest_doc_photo_path text;

comment on column public.bookings.guest_doc_photo_path is
  'Path en el bucket `checkin-ids` de la foto del documento escaneada por el host al crear la reserva. Se hereda a checkin_records.id_photo_path en el primer lookup del huésped.';

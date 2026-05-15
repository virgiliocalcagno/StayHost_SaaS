-- ============================================================================
-- Sprint 2: fotos para upsells + bucket público con RLS path-based
-- Date: 2026-05-15
--
-- Why:
--   Sin fotos el catálogo se siente vacío y el huésped no se decide a
--   comprar. Esta migración:
--     1) Agrega hero_photo y gallery_photos a upsells (upsell_vendors ya
--        tenía hero_photo desde Sprint 1.5).
--     2) Crea bucket público 'upsell-photos' para servir las imágenes al
--        Hub público (sin auth — son fotos comerciales).
--     3) RLS path-based: solo el dueño del tenant puede escribir/borrar
--        en su prefijo. Read es público para que el huésped vea las fotos.
--
-- Path convention:
--   <tenant_id>/upsell/<upsell_id>/<filename>.webp
--   <tenant_id>/vendor/<vendor_id>/<filename>.webp
-- ============================================================================

alter table public.upsells
  add column if not exists hero_photo text;

-- Array de URLs en jsonb. Sin tabla aparte para simplificar — el array
-- difícilmente supera 5-6 fotos por producto.
alter table public.upsells
  add column if not exists gallery_photos jsonb not null default '[]'::jsonb;

-- Bucket público con límite 2MB y mime allowlist. WebP es el formato target
-- (compresión cliente), pero aceptamos JPEG/PNG por si alguien sube directo
-- desde móvil sin que pase por el converter.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'upsell-photos',
  'upsell-photos',
  true,
  2 * 1024 * 1024,
  array['image/webp','image/jpeg','image/png']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Lectura pública (el Hub al huésped no tiene auth pero necesita ver fotos).
drop policy if exists upsell_photos_read on storage.objects;
create policy upsell_photos_read on storage.objects
  for select to public
  using (bucket_id = 'upsell-photos');

-- Escritura solo para el dueño del tenant cuyo id es el primer segmento
-- del path. storage.foldername() devuelve los segmentos antes del filename.
drop policy if exists upsell_photos_insert on storage.objects;
create policy upsell_photos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'upsell-photos'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
  );

drop policy if exists upsell_photos_update on storage.objects;
create policy upsell_photos_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'upsell-photos'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
  )
  with check (
    bucket_id = 'upsell-photos'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
  );

drop policy if exists upsell_photos_delete on storage.objects;
create policy upsell_photos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'upsell-photos'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
  );

-- ============================================================================
-- Seed: Directorio de Proveedores Punta Cana 2026 (datos reales)
-- Tenant: virgiliocalcagno@gmail.com
-- Fuente: Directorio Proveedores Punta Cana 2026.xlsx
--
-- NO se ejecuta automáticamente. Correr manualmente en Supabase SQL Editor
-- (o con `supabase db execute`) cuando la tabla service_vendors ya exista.
--
-- Idempotente: usa NOT EXISTS por (tenant_id, name) para evitar duplicados
-- si se ejecuta múltiples veces.
-- ============================================================================

do $$
declare
  v_tenant_id uuid;
begin
  -- Resolver el tenant_id del owner a partir del email.
  select id into v_tenant_id
  from public.tenants
  where lower(email) = 'virgiliocalcagno@gmail.com'
  limit 1;

  if v_tenant_id is null then
    raise exception 'No se encontró tenant para virgiliocalcagno@gmail.com';
  end if;

  -- ── INSERT ────────────────────────────────────────────────────────────────
  -- Mapeo Excel → StayHost:
  --   Multiservicios       → maintenance [other]       (multi-trade)
  --   Aire Acondicionado   → maintenance [appliance]   (HVAC)
  --   Cerrajeros           → maintenance [other]       (locksmith)
  --   Cerraduras Electr.   → maintenance [other]       (smart locks)
  --   Seguridad Electr.    → services    [other]       (cámaras/alarmas)
  --   Tecnología & WiFi    → utilities   [internet]
  --   Calentadores         → maintenance [appliance]
  --   Plomeros             → maintenance [plumbing]
  --   Electricistas        → maintenance [electrical]
  --   Electrodomésticos    → maintenance [appliance]
  --   Limpieza             → services    [other]       (cleaning company)
  --   Limpieza (Colchones) → services    [other]       (mattress cleaning)
  --   Piscinas / Jacuzzi   → maintenance [structural]
  --   Carros de Golf       → services    [other]
  --   Rent a Car           → services    [other]
  --   Transportación       → services    [other]
  --   Fumigación           → services    [other]
  --   Administradores      → services    [other]

  insert into public.service_vendors (tenant_id, name, phone, type, subcategories, notes, active)
  select v_tenant_id, v.name, v.phone, v.type, v.subcategories::jsonb, v.notes, true
  from (values
    -- Multiservicios
    ('D & R Solutions',              '+18298472493', 'maintenance', '["other"]',       'Multiservicios — cubre múltiples oficios'),
    ('I.M Home Repair & Mgmt',       '+18494724260', 'maintenance', '["other"]',       'Multiservicios + administración'),
    ('Solucser Ventura',             '+18299300869', 'maintenance', '["other"]',       'Multiservicios'),

    -- Aire Acondicionado (HVAC)
    ('Servivenza',                   '+18096614662', 'maintenance', '["appliance"]',   'Aire acondicionado'),
    ('Ronaldo',                      '+18295048940', 'maintenance', '["appliance"]',   'Aire acondicionado'),
    ('Victor Vilorio',               '+18093567409', 'maintenance', '["appliance"]',   'Aire acondicionado'),

    -- Cerrajeros
    ('Samboy',                       '+18293214520', 'maintenance', '["other"]',       'Cerrajero tradicional'),
    ('Virgilio Calcano',             '+18092585009', 'maintenance', '["other"]',       'Cerrajero tradicional'),

    -- Cerraduras Electrónicas
    ('Miguel',                       '+18295664966', 'maintenance', '["other"]',       'Cerraduras electrónicas / smart locks / TTLock'),

    -- Seguridad Electrónica (cámaras, alarmas)
    ('Starling Ramos',               '+18297608929', 'services',    '["other"]',       'Seguridad electrónica — cámaras, alarmas, CCTV'),
    ('Douglas Blas',                 '+18097814628', 'services',    '["other"]',       'Seguridad electrónica — cámaras, alarmas, CCTV'),

    -- Tecnología & WiFi
    ('Uptime Service',               '+18098028967', 'utilities',   '["internet"]',    'Tecnología, WiFi, redes'),

    -- Calentadores
    ('Jancer',                       '+18094652332', 'maintenance', '["appliance"]',   'Calentadores de agua'),

    -- Plomeros
    ('Cindy',                        '+18297673148', 'maintenance', '["plumbing"]',    'Plomería'),
    ('Alexander / MaserHome',        '+18496511625', 'maintenance', '["plumbing"]',    'Plomería (MaserHome)'),

    -- Electricistas
    ('Rhadames',                     '+18094286160', 'maintenance', '["electrical"]',  'Electricidad'),
    ('GSEM / Yorandi',               '+18296196507', 'maintenance', '["electrical"]',  'Electricidad (GSEM)'),

    -- Electrodomésticos
    ('Ariel (Lavadoras)',            '+18097694975', 'maintenance', '["appliance"]',   'Especialista en lavadoras'),
    ('Corripio (Estufa)',            '+18099056550', 'maintenance', '["appliance"]',   'Corripio — reparación de estufas/cocinas'),

    -- Limpieza (empresas externas de cleaning)
    ('Coral Cleaning',               '+18094086332', 'services',    '["other"]',       'Empresa de limpieza profesional'),
    ('Reluciente Punta Cana',        '+18298472493', 'services',    '["other"]',       'Empresa de limpieza profesional'),

    -- Limpieza Colchones
    ('Clean Couch',                  '+18093523063', 'services',    '["other"]',       'Limpieza profunda de colchones y sofás'),

    -- Piscinas / Jacuzzi
    ('Fausto',                       '+18098213489', 'maintenance', '["structural"]',  'Mantenimiento de piscinas y jacuzzis'),

    -- Carros de Golf
    ('We move RD',                   '+18296386875', 'services',    '["other"]',       'Alquiler/servicio carros de golf'),

    -- Rent a Car
    ('Cat rent a car',               '+18096691764', 'services',    '["other"]',       'Renta de vehículos'),

    -- Transportación
    ('Punta Cana Transfer Service',  '+18095131436', 'services',    '["other"]',       'Transfers desde/hacia aeropuerto'),

    -- Fumigación
    ('PowerPlag',                    '+18499159182', 'services',    '["other"]',       'Fumigación / control de plagas'),

    -- Administradores
    ('Nadesha Guzman',               '+18094373282', 'services',    '["other"]',       'Administradora de propiedades')
  ) as v(name, phone, type, subcategories, notes)
  where not exists (
    select 1 from public.service_vendors sv
    where sv.tenant_id = v_tenant_id and sv.name = v.name
  );

  raise notice 'Proveedores Punta Cana 2026 ingresados para tenant %', v_tenant_id;
end $$;

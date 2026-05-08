# Módulo de Limpieza — Modelo canónico

**Fecha:** 2026-05-04
**Status:** Documento de verdad. Toda implementación referencia esto.

---

## 1. Roles (jerarquía estricta)

```
admin > supervisor > cleaner
       supervisor > maintenance
```

Una sola columna `team_members.role`. Sin arrays, sin multi-rol. Si una persona limpia y supervisa, su rol es `supervisor` y se le asigna a tareas como cleaner cuando corresponde. La app `/supervisor` muestra "Mis limpiezas" y "Limpiezas del equipo" en pestañas separadas.

| Rol | Descripción | App principal | Cookie `sh_role` |
|---|---|---|---|
| `admin` | Owner del SaaS, ve y hace todo del tenant | `/dashboard` | `admin` |
| `supervisor` | Coordina un equipo de cleaners. Aprueba evidencia | `/supervisor` (PWA mobile) | `supervisor` |
| `cleaner` | Personal de limpieza de campo | `/staff` (PWA mobile) | `cleaner` |
| `maintenance` | Personal de mantenimiento | `/staff` (mismo flujo) | `maintenance` |

## 2. Tipo laboral (cruzado con rol)

```sql
team_members.employment_type ∈ ('contractor', 'employee')
```

| `employment_type` | Cobra | Ve montos en la app |
|---|---|---|
| `contractor` | Por tarea | ✅ los suyos |
| `employee` | Salario fuera del SaaS | ❌ nunca |

**Regla maestra:** antes de renderizar cualquier $, chequear `employment_type`. `employee` → la columna no se renderiza. Aplicado server-side en el endpoint que sirve los datos, no se confía en el cliente.

## 3. Datos clave por tarea (`cleaning_tasks`)

| Columna | Tipo | Quién ve |
|---|---|---|
| `assignee_id` | uuid → team_members | admin, supervisor del cleaner, el cleaner asignado |
| `validated_at` | timestamptz | todos los que ven la tarea |
| `validated_by` | uuid → team_members | admin, supervisor (cleaner ve "supervisor") |
| `rejection_note` | text | admin, supervisor, cleaner asignado |
| `closure_photos` | jsonb | admin, supervisor, cleaner asignado |
| `client_price` | numeric | admin |
| `cleaner_payout` | numeric | admin, supervisor del equipo, cleaner contractor |
| `supervisor_payout` | numeric | admin, supervisor contractor (solo el suyo) |

**Margen** = `client_price − cleaner_payout − supervisor_payout`. No se guarda, se calcula. Solo admin lo ve.

## 4. Default de precios

```sql
properties.default_client_price       -- empresa cobra al dueño
properties.default_cleaner_payout     -- empresa paga al cleaner
properties.default_supervisor_payout  -- empresa paga al supervisor
```

Cada tarea hereda estos defaults al crearse. Admin/supervisor pueden override por tarea.

> **Estado actual:** existe `properties.cleaner_payout` pero el nombre no es consistente con la spec. Hay que renombrar a `default_cleaner_payout` y agregar las otras dos.

## 5. Privacidad de montos (matriz)

| Rol | client_price | cleaner_payout | supervisor_payout | Margen |
|---|:-:|:-:|:-:|:-:|
| admin | ✅ todos | ✅ todos | ✅ todos | ✅ |
| supervisor (contractor) | ❌ | ✅ su equipo | ✅ el suyo | ❌ |
| supervisor (employee) | ❌ | ❌ | ❌ | ❌ |
| cleaner (contractor) | ❌ | ✅ el suyo en sus tareas | ❌ | ❌ |
| cleaner (employee) | ❌ | ❌ | ❌ | ❌ |

Implementación: el endpoint server-side filtra columnas según el rol. RLS solo bloquea lectura raw a la tabla. Audit log: query inválida a columnas $ → registrar y alertar.

## 6. Asignación supervisor ↔ propiedad ↔ cleaner

```sql
team_members.supervisor_id uuid REFERENCES team_members(id)  -- cleaner reporta a supervisor
properties.supervisor_id uuid REFERENCES team_members(id)    -- propiedad bajo supervisor
```

- Una propiedad → 1 supervisor (NULL = admin la maneja directo)
- Un cleaner → 1 supervisor
- Reasignación entre supervisores: SOLO admin
- Tareas derivan supervisor de la propiedad (no se duplica columna)

## 7. Lógica de prioridad (refinada)

Una tarea es **CRÍTICA** si cualquiera de:

- `priority === "critical"` (override manual)
- es para **HOY** y `dueTime < 06:00`
- es para **MAÑANA** y `is_back_to_back === true`
- es para **MAÑANA** y `dueTime < 07:00`
- es **MAÑANA** y NO tiene `assignee_id` asignado (sin staff confirmado)

Una tarea es **ALTA** si:

- es para HOY y NO crítica
- es para MAÑANA y NO crítica

Una tarea es **MEDIA** si está en los próximos 7 días.
Resto **BAJA**.

> **Estado actual:** `getPriorityInfo` solo marca crítica `today + hour<6` o `priority="critical"`. Todo el resto de la lógica falta.

## 8. Aprobación de evidencia

Default: aprueba el supervisor del cleaner asignado. Admin puede aprobar cualquiera (override).

Reglas duras:
- Nadie aprueba su propia tarea
- Si supervisor también limpió → escala al admin
- Admin único → auto-aprobación con `approval_log = {by: 'admin-self', auto: true}`
- Múltiples admins activos → par-revisión entre admins

Escalación si supervisor no aprueba:
| Tiempo | Acción |
|---|---|
| 4h | Push silencioso al supervisor |
| 12h | Push insistente + email |
| 24h | Sube al admin con badge "huérfana de aprobación" + WhatsApp opcional |
| Nunca | Auto-aprobar (rompe anti-fraude) |

`approval_log jsonb[]` en `cleaning_tasks` registra historial.

## 9. Ciclo de pago (Sprint C)

Tabla `payouts` agrupa tareas validadas no liquidadas en un periodo. Tabla `payout_items` enlaza tarea ↔ payout.

Flujo:
1. Admin abre módulo "Pagos" en `/dashboard`
2. Selecciona periodo (semana/quincena/mes/custom) + filtros
3. Sistema agrupa tareas `completed + validated_at != null + sin payout_item` por miembro
4. Preview de montos → admin confirma → `payouts.status = 'pending'`
5. Admin paga afuera del SaaS (efectivo/transferencia/PayPal)
6. Admin marca `paid` con `payment_method` + `reference`
7. Push al miembro: "Pago confirmado: $X por N tareas del A al B"

**Vista cleaner contractor** (pestaña "Mis pagos" en `/staff/wallet`):
- Periodo en curso (estimado, no liquidado)
- Pagos liquidados con fecha, método, total, # tareas

**Cleaner employee:** sin pestaña de pagos. Solo "Mis tareas terminadas" sin $.

## 10. Estado real vs canónico (gap matrix)

| Pieza | Spec | Implementado | Falta |
|---|:-:|:-:|---|
| `validated_at` | ✅ | ✅ (en esta rama) | nada |
| `validated_by`, `rejection_note` | ✅ | ⚠️ solo en `feat/cleaning-evidence-real` | mergear esa rama |
| `properties.cleaner_payout` | ✅ | ✅ | renombrar a `default_cleaner_payout` |
| `properties.default_client_price`, `default_supervisor_payout` | ✅ | ❌ | migración |
| `cleaning_tasks.client_price`, `cleaner_payout`, `supervisor_payout`, `currency` | ✅ | ❌ | migración + heredar de propiedad al crear |
| `team_members.supervisor_id`, `properties.supervisor_id` | ✅ | ❌ | migración |
| `team_members.employment_type` | ✅ | ❌ | migración + UI en perfil |
| Tabla `payouts`, `payout_items` | ✅ | ❌ | migración + endpoints |
| Endpoint POST validate (supervisor aprueba) | ✅ | ⚠️ en rama feature | mergear |
| Endpoint upload fotos reales con timestamp | ✅ | ⚠️ en rama feature | mergear |
| Privacidad de montos server-side | ✅ | ❌ | implementar filtrado por rol en endpoints |
| Lógica de prioridad refinada | ✅ | ❌ | refactor de `getPriorityInfo` |
| App `/supervisor` PWA | ✅ | ❌ | feature completo |
| Panel "Pagos" en admin | ✅ | ❌ | feature completo |
| `/staff/wallet` con monto pendiente | ✅ | ✅ | conectar al ciclo de payouts |
| `approval_log jsonb[]` | ✅ | ❌ | migración + lógica |
| Escalación 4h/12h/24h | ✅ | ❌ | cron + push |
| `evidence_criteria` por propiedad | ✅ | ✅ | nada |

## 11. Orden de batalla (cierre del módulo)

Cada paso es un PR independiente. Mergeable por separado, no se acumulan.

### Fase 0 — Cerrar lo abierto (1 sesión)
1. Mergear `feat/cleaning-wallet` (esta rama, ya casi)
2. Mergear `feat/cleaning-evidence-real` → master tiene fotos reales + `validated_by` + `rejection_note`
3. Mergear `feat/cleaning-ratings` (rating post-limpieza)

### Fase 1 — Modelo canónico de datos (1 sesión)
4. Migración: agregar `team_members.supervisor_id`, `team_members.employment_type`, `properties.supervisor_id`
5. Migración: renombrar `properties.cleaner_payout` → `default_cleaner_payout`. Agregar `default_client_price`, `default_supervisor_payout`
6. Migración: `cleaning_tasks.client_price`, `cleaner_payout`, `supervisor_payout`, `currency`. Trigger que hereda defaults de propiedad al INSERT
7. Migración: `cleaning_tasks.approval_log jsonb[]`

### Fase 2 — Reglas de negocio (1 sesión)
8. Refactor `getPriorityInfo` con la lógica del punto 7 de este doc
9. Privacidad server-side: helper `filterMoneyByRole(task, user)` aplicado en `/api/cleaning-tasks` y `/api/staff/wallet`
10. Endpoint POST `/api/cleaning-tasks/:id/validate` con check "no validar la propia"

### Fase 3 — App supervisor (2-3 sesiones)
11. Ruta `/supervisor` con bottom-tab nav (Inicio, Tareas, Equipo, Bandeja)
12. Pantalla de aprobación de evidencia (foto fullscreen, ✓/↻)
13. Cron de escalación 4h/12h/24h

### Fase 4 — Pagos (2 sesiones)
14. Tabla `payouts` + `payout_items` + endpoints
15. Panel "Pagos" en `/dashboard`: generar corte, marcar pagado
16. Conectar wallet del cleaner al ciclo: muestra periodos liquidados

### Fase 5 — Pulido
17. UI: redundancia "Completadas Hoy" vs "Billetera" — el botón Completadas Hoy lleva a la sección "este período" de la wallet, no a la wallet entera (deja de ser redundante)
18. Métricas del supervisor en dashboard del admin
19. Ranking del cleaner (gamificación opcional)

---

## Decisiones que NO se discuten más (cerradas con Virgilio)

1. Roles superset jerárquico (no array). Una propiedad UN supervisor. Cleaners no se prestan entre supervisores.
2. 3 precios distintos. Default por propiedad + override por tarea.
3. Cleaner ve precio ANTES de aceptar.
4. Periodo de corte default semanal, configurable por tenant.
5. NO adelantos en V1.
6. Supervisor ve pagos de su equipo read-only (no paga).
7. NO auto-aprobar evidencia jamás. Escalar al admin a 24h.
8. LATAM = pagos efectivo/transferencia/PayPal. NO Stripe ni marketplace en V1.

# Plan de Arquitectura: Dual-Sync Engine (iCal + Channex API)

Este plan define cómo estructuraremos StayHost para soportar dos niveles de servicio: un nivel gratuito basado en **iCal** y un nivel profesional basado en la **API de Channex**.

## User Review Required

> [!IMPORTANT]
> **Modelo de Negocio**: He verificado que Channex cobra una tarifa plana de White-label (~$130/mes) + un costo por propiedad (~$2-$5/mes). Para que tu negocio sea rentable, el Plan Pro de StayHost debería costar al menos $15-$20 USD por propiedad.

> [!WARNING]
> **Limitación de iCal**: Como confirmamos, el iCal no envía el nombre del huésped. Proponemos añadir un paso de "Enriquecimiento Manual" solo para los usuarios del plan gratuito.

## Proposed Changes

### 1. Núcleo de Sincronización (Abstracción)

Crearemos una capa intermedia para que el resto de la aplicación (Calendario, Check-ins, Limpieza) no tenga que saber si los datos vienen de un iCal o de la API.

#### [NEW] `src/lib/sync/provider.interface.ts`
Define la interfaz `BookingProvider` con métodos como:
- `syncBookings(propertyId: string)`
- `updatePrice(propertyId: string, date: string, price: number)` (Solo API)
- `importProperty(listingUrl: string)` (Solo API)

#### [NEW] `src/lib/sync/ical-provider.ts`
Implementación para el plan gratuito. 
- Usará el parser actual pero con lógica de "Fuzzy matching" para detectar reservas de Airbnb/Booking.

#### [NEW] `src/lib/sync/channex-provider.ts`
Implementación para el plan Pro.
- Conecta con `api.channex.io`.
- Implementa la creación automática de propiedades.

### 2. Módulo de Check-ins (Fix para iCal)

#### [MODIFY] `src/components/dashboard/CheckInsPanel.tsx`
Añadiremos un estado visual para las reservas que vienen de iCal:
- **Estado "Pendiente de Datos"**: Si la reserva viene de iCal y no tiene nombre del huésped.
- **Botón "Completar Datos"**: Abre un pequeño modal para que el host escriba Nombre/Apellido/Email. Una vez guardado, se activa el check-in automático.

### 3. Creación de Propiedades

#### [MODIFY] `src/components/dashboard/PropertiesPanel.tsx`
Actualizaremos el modal de "Nueva Propiedad" para dar dos opciones:
1. **"Importar desde Airbnb (Pro)"**: El usuario solo pone el link, y nosotros usamos la API de Channex para bajar fotos, títulos y descripciones.
2. **"Configuración Manual (Gratis)"**: El flujo actual donde el usuario sube todo.

## Open Questions

1. **Tokens de Channex**: ¿Tienes ya una cuenta de Channex (Staging/Sandbox) o quieres que usemos datos "dummy" por ahora para dejar la interfaz lista?
2. **Prioridad**: ¿Prefieres que primero deje el flujo **iCal (Gratis)** funcionando al 100% con el "Enriquecimiento Manual" de nombres, o que empiece directamente con los módulos de la **API (Pro)**?

## Verification Plan

### Manual Verification
- Crear una propiedad vía iCal y verificar que aparece el aviso de "Falta nombre del huésped".
- Simular una importación vía API y ver cómo se auto-rellenan los campos de la propiedad.
- Verificar que el calendario muestra la fuente de la reserva (Icono de iCal vs Icono de API).

# Auditoría del Módulo de Limpieza (CleaningPanel)

El documento analiza en profundidad el componente principal `CleaningPanel.tsx` de la aplicación StayHost. Este módulo centraliza las operaciones del flujo de limpieza y mantenimiento, separando la experiencia en dos modos: **Administrador** y **Staff (Personal)**.

## 1. Arquitectura y Modelado de Datos

### Origen de los Datos (Estado Local)
El módulo consume la información del localStorage para asegurar la integración dinámica con otros paneles:
- `stayhost_properties`: Importa la configuración de propiedades (criterios de evidencia, instrucciones, asignación automática, configuración de camas).
- `stayhost_team`: Importa a los miembros del equipo, calculando dinámicamente si están disponibles (`available`) y cruzando la información con su teléfono para contacto directo.

### Modelo de Tarea (`CleaningTask`)
Cada tarea contiene información crítica para el flujo:
- **Metadatos e Identificación**: ID, Propiedad (ID y nombre), Huésped (nombre, número de personas), estancias (`stayDuration`).
- **Tiempos**: Fecha y hora de salida (`dueTime`, `dueDate`), hora en la que inició limpieza (`startTime`).
- **Estados**: 
  - Condición general (`status`): *pending, in_progress, completed, issue, unassigned, assigned, accepted, rejected*.
  - Aceptación del personal (`acceptanceStatus`): *pending, accepted, declined*.
  - Validación (`isWaitingValidation`): Activo cuando el personal termina pero el admin no aprueba.
- **Flags Específicas**: `isBackToBack` (Requiere entrega urgente el mismo día) y `isVacant` (Propiedad vacía, que le quita prioridad).
- **Procesamiento**: `checklistItems`, `evidenceCriteria` requeridas, fotos finales subidas (`closurePhotos`).

### Lógica de Prioridades (`getPriorityInfo`)
Motor principal para organizar y llamar la atención de las tareas. Cuatro niveles:
1. **Nivel 1: Urgente (Rojo Parpadeante)**: El checkout es HOY *y* el dueTime está en menos de 6h, *o* el admin forzó prioridad "Crítica" / "Back-to-Back".
2. **Nivel 2: Alta (Rojo Sólido)**: El checkout es HOY, independientemente de la hora si es > 6h.
3. **Nivel 3: Media (Amarillo)**: Salidas programadas para MAÑANA.
4. **Nivel 4: Baja (Verde)**: Salidas a futuro (diferente a hoy o mañana).

---

## 2. Flujo del Administrador ("Gestión Operativa")

Esta es la pantalla por defecto. Es un centro de mando para monitorear, crear y controlar salidas.

### A. Elementos Superiores y Vistas
- **Tabs "Diaria" vs "Semanal"**: Alterna el filtro principal visualizando solo el día de hoy, o una lista general filtrable por un carrusel de días.
- **Tarjeta de Estadísticas (Top Panel)**: Muestra Checkouts de Hoy, Total "Back-to-Back" urgentes, tareas completadas en el día, y pendientes.
- **Botón "Nueva Orden"**: Abre un Modal (Ver sección "Crear Nueva Tarea") para inyectar una tarea de forma manual en el flujo.

### B. Resumen de Ropa de Cama (`linenSummary`)
- **Lógica Automática**: Analiza todas las tareas programadas para el día de hoy. Obtiene el string `bedConfiguration` (Ej: "2 Queen, 1 King") de la propiedad de cada tarea.
- **Agrupamiento**: Suma y consolida, reportándole automáticamente al administrador o jefe de limpieza cuántos juegos físicos de sábanas de King, Queen o Matrimoniales necesitan prepararse en la lavandería *para ese día en total*.

### C. Listado de Tareas y Control
- **Filtro de Staff**: Desplegable para ver las tareas totales o de un miembro específico del equipo.
- **Control de Asignación por Tarea**: En cada "card" de tarea, el administrador puede abrir un dropdown para:
  - Cambiar el asignado manualmente (sobreescribe la lógica de autoasigación).
- **Botón WhatsApp**: Se activa solo al asignar un staff. Usa la URL configurada con un *deep parameter* (`?view=staff&task={id}`) mandándosela al celular del personal para que abra la App directamente.
- **Validación Final**: Entra cuando el empleado "Terminó la limpieza".
  - **Opción "Ver Fotos"**: Muestra que existen fotos subidas por el usuario.
  - **Botón "Validar y Cerrar"**: Marca finalmente la tarea como `completed`, quitando la bandera de `waitingValidation`. Además suma una tarea completada al perfil de ese miembro del equipo y resta sus pendientes del día.

### D. Panel Lateral (Insights)
- **Staff Disponible**: Lista a todos los miembros filtrados del `team`, enseñando capacidad en tiempo real (X tareas hoy vs X tareas terminadas).
- **Asignación Automática Inteligente**: Widget para informar si hay propiedades con el switch "autoAssignCleaner" encendido preparadas para delegar.

---

## 3. Creación de una Tarea (Modal "Nueva Orden")

Cuando el Administrador toca "Nueva Orden":
- **Campos**: Se seleccionan la propiedad, fecha, hora de salida, huésped, cantidad de huéspedes, y el nivel de prioridad forzada.
- **Switches Operativos**: 
  - `Back-to-back`: Alerta a máximo nivel de prioridad asumiendo un checkin inmediato.
  - `Propiedad Vacante`: Reduce la prioridad al mínimo visual ya que no hay prisa porque entre otra persona.
- **Asignador Automático (`autoAssignFromProperty`)**: Si la propiedad elegida tiene un esquema automatizado (`autoAssignCleaner: true`), la lógica lee el `cleanerPriorities` (arreglo de IDs ordenado). Toma el primer limpiador que tenga el valor `available: true` en ese instante e instantáneamente le asigna (*assigned*) a esa persona antes de crear la tarea. Si todos están listados como no disponibles, queda *unassigned*.
- **Acción (Botón "Crear Orden")**: Inyecta en el estado principal del panel de limpieza la tarea, resetea el formulario y oculta el modal.

---

## 4. Flujo del Personal / Staff ("Modulo App")

Es la vista mobile-first diseñada para el trabajador en campo. Se puede entrar simulándolo desde el admin ("Simular App Staff"), o por el link directo de whatsapp donde la página lo detectará por los `searchParams` y le colocará la vista de Staff.

### A. Vista Principal (Home del Limpiador)
- **Perfil Superior**: Indica el empleado actúalmente conectado (En demo forzado a "Laura" ID 1) con sus resúmenes de tareas urgentes vs totales del día.
- **Selector de Cronograma**: Píldoras para filtrar: "Hoy", "Mañana", "Semana".
- **Listado Tareas de Campo**: Ordenadas siempre priorizando las Urgentes en Rojo sobre las rutinarias. 
- Al tocar una tarea, se abren los detalles y cambia el estado a `staffAppScreen="task"`.

### B. Vista Previa de una Tarea (Antes de Empezar / Aceptar)
Se muestra toda la información principal destacando una imagen full-screen de la propiedad, la dirección e instrucción.
- Se lee el `bedConfiguration` en una tarjeta especial "Ropa de cama a preparar" para que el empleado haga acopio de los insumos.
- Indicadores brillantes si es back-to-back o vacante para regular el estrés.
- Instrucciones base (*Standard Instructions*): Extraídas directamente de la propiedad (Si el admin le puso reglas "Apagar el aire, revisar control de tv", se ven aquí).

### C. Lógica de Aceptación / Rechazo (AcceptanceStatus):
Esta es una pantalla de compromiso que ve primero el limpiador:
- **Botón "Aceptar Tarea" (`handleAcceptTask`)**: Da un *OK* a la operadora. Mueve el estado general a `accepted`. Quita los botones y permite empezar el ciclo de trabajo.
- **Botón "Rechazar"**: Exige motivo. 
  - **Flujo Re-direccional (`handleDeclineTask`)**: Al presionar Rechazar, añade al limpiador a un array `declinedByIds`. Entonces la función vuelve a llamar al Asignador Automático (`autoAssignFromProperty`) excluyendo al limpiador actual e iterando la cadena de prioridades en la base. Si encuentra un relevo lo asigna silenciosamente, y si no avisa se tira como status `rejected` final para que el admin lo solvente. Muestra el motivo exacto que escribieron.

### D. Flujo de Trabajo Activo (El Wizard o Asistente en 3 Pasos)
Cuando el limpiador le da al botón enorme **"Marcar Inicio de Limpieza"** (`handleStartCleaning`):
1. Pone el estatus general a `in_progress` registrándole al Admin con un "pulse beacon" y la hora exacta en la que el limpiador empezó a trabajar gracias a `startTime`.
2. Habilita un Wizard en pasos:
   - **Paso 1: Checklist de Tareas**: Pinta una serie de tareas interactuables (`toggleChecklistItem`). Cada check genera un tic verde visual y reporta el progreso real (%) arriba en el admin. Estas tareas de limpieza pueden ser tipo "general" o "appliance".
   - **Paso 2: Suministros e Incidencias**: Usa la bandera `stayDuration` (Noches) de la tarea para multiplicar calculando insumos. Ej: Más de 3 noches, exigen el doble de papel higiénico. Indica números a reponer reales x4 o x6. Tiene un textarea extra grande para "Alguna novedad o daño?".
   - **Paso 3: Evidencia Final**: Bloqueo de salida rígido.
     - Lee desde la propiedad el `evidenceCriteria` (Ej: "Cocina, Foto Cama Tendida, Foto control del TV"). Si el admin determinó esas tres áreas, el App genera 3 botones de cámara ineludibles.
     - Al presionar (Muteado con `handleUploadPhoto` usando un mockup placeholder), avanza.
     - Lógica Final: **El Botón Enviar no se habilita** (`disabled={tempPhotos.length < activeCriteria.length}`) hasta que la cantidad de fotos subidas no sea coincidente con la lista obligatoria impuesta del admin.
     - **"Enviar y Terminar" (`handleSubmitTask`)**: Esconde el panel de staff, levanta la bandera mágica `isWaitingValidation`, y el admin ve en tiempo real su solicitud de cerrado.

---

## 5. Glosario de Funciones Core

* `getStatusBadge`: Centraliza de manera semántica todos los estados del ciclo de vida pintando con clases de TailwindCSS cada badge necesario (colores verdes, amarillos, rojos).
* `getPriorityInfo`: Dictamina matemáticamente colores (Rojo vivo, ámbar, verde) e íconos en base a plazos y urgencias.
* `getStayDuration`: (Mock) Simulación para extraer la duración de noches de un huésped dado usando ID.
* `handleSendMessage`: Transforma variables de UI (property name, whatsapp link, deeplink de la aplicación) abriendo un webchat configurado por url encode.
* `autoAssignFromProperty`: Iterador lógico inteligente. Saltea limpiadores bloqueadores en `skipIds` y toma al primero vivo validando contra un localStorage modificado reactivamente.

*Fin del Documento de Auditoría*

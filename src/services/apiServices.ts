/**
 * apiServices.ts
 *
 * Capa de acceso a datos asíncrona. Actualmente lee desde localStorage para
 * mantener compatibilidad con el flujo existente. Cuando exista un backend,
 * reemplaza el cuerpo de cada función con la llamada HTTP correspondiente
 * (fetch / axios) sin tocar ningún componente.
 */

// ─── Tipos exportados ────────────────────────────────────────────────────────

export interface RawTeamMember {
  id: string;
  name: string;
  role: string;
  avatar?: string;
  tasksToday?: number;
  tasksCompleted?: number;
  phone: string;
  available?: boolean;
}

export interface RawProperty {
  id: string;
  name: string;
  address?: string;
  image?: string;
  autoAssignCleaner?: boolean;
  cleanerPriorities?: string[];
  bedConfiguration?: string;
  standardInstructions?: string;
  evidenceCriteria?: string[];
  [key: string]: unknown;
}

// ─── Claves de almacenamiento ────────────────────────────────────────────────

const STORAGE_KEYS = {
  team:       "stayhost_team",
  properties: "stayhost_properties",
  tasks:      "stayhost_tasks",
} as const;

// ─── Helper interno ──────────────────────────────────────────────────────────

function readStorage<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

// ─── API pública ─────────────────────────────────────────────────────────────

/** Devuelve el equipo tal como está almacenado. */
export async function getTeam(): Promise<RawTeamMember[]> {
  return readStorage<RawTeamMember>(STORAGE_KEYS.team);
}

/** Devuelve las propiedades tal como están almacenadas. */
export async function getProperties(): Promise<RawProperty[]> {
  return readStorage<RawProperty>(STORAGE_KEYS.properties);
}

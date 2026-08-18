import { asc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { machineModels } from "../db/schema";

export const DEFAULT_MACHINE_MODELS = [
  "Joker", "Terrano", "Tiger", "Pronto", "Cruiser", "Maestro", "Avatar",
  "Leeb", "Finer", "Transformer", "Sprinter", "Focus", "Partner", "Express", "Cultro",
] as const;

async function ensureMachineModelsTable() {
  const { env } = await import("cloudflare:workers");
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS machine_models (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
}

export async function listMachineModels() {
  await ensureMachineModelsTable();
  const db = await getDb();
  const existing = await db.select().from(machineModels).orderBy(asc(machineModels.name));
  if (!existing.length) {
    const now = new Date().toISOString();
    await db.insert(machineModels).values(DEFAULT_MACHINE_MODELS.map((name) => ({ name, active: true, createdAt: now, updatedAt: now })));
  }
  return db.select().from(machineModels).where(eq(machineModels.active, true)).orderBy(asc(machineModels.name));
}

export async function ensureMachineModelsStorage() {
  await ensureMachineModelsTable();
  return getDb();
}

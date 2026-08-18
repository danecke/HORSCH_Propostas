import { asc, eq } from "drizzle-orm";
import { ensureMachineModelsStorage, listMachineModels } from "../../../lib/master-data";
import { getAccessProfile } from "../../../lib/access";
import { machineModels } from "../../../db/schema";

export const dynamic = "force-dynamic";

function canManage(profile: Awaited<ReturnType<typeof getAccessProfile>>) {
  return Boolean(profile && ["general_admin", "global_management"].includes(profile.role));
}

function errorResponse(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function GET(request: Request) {
  const profile = await getAccessProfile();
  if (!profile) return errorResponse("Acesso não autorizado.", 403);
  try {
    const includeInactive = new URL(request.url).searchParams.get("all") === "1" && canManage(profile);
    const models = includeInactive
      ? await (async () => {
          const db = await ensureMachineModelsStorage();
          return db.select().from(machineModels).orderBy(asc(machineModels.name));
        })()
      : await listMachineModels();
    return Response.json({ models: models.map((model) => ({ id: model.id, name: model.name, active: model.active })) });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Não foi possível carregar os modelos de máquinas.", 500);
  }
}

export async function POST(request: Request) {
  const profile = await getAccessProfile();
  if (!profile || !canManage(profile)) return errorResponse("Somente ADM e Gestão Global podem alterar a base de modelos.", 403);
  const body = await request.json().catch(() => null) as { name?: unknown } | null;
  const name = String(body?.name ?? "").trim().replace(/\s+/g, " ");
  if (!name || name.length < 2 || name.length > 80) return errorResponse("Informe um modelo entre 2 e 80 caracteres.");
  try {
    const db = await ensureMachineModelsStorage();
    const [existing] = await db.select().from(machineModels).where(eq(machineModels.name, name)).limit(1);
    if (existing) {
      if (!existing.active) await db.update(machineModels).set({ active: true, updatedAt: new Date().toISOString() }).where(eq(machineModels.id, existing.id));
      return Response.json({ model: { id: existing.id, name: existing.name, active: true } });
    }
    const now = new Date().toISOString();
    const [created] = await db.insert(machineModels).values({ name, active: true, createdAt: now, updatedAt: now }).returning();
    return Response.json({ model: { id: created.id, name: created.name, active: created.active } }, { status: 201 });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Não foi possível salvar o modelo.", 500);
  }
}

export async function PATCH(request: Request) {
  const profile = await getAccessProfile();
  if (!profile || !canManage(profile)) return errorResponse("Somente ADM e Gestão Global podem alterar a base de modelos.", 403);
  const body = await request.json().catch(() => null) as { id?: unknown; name?: unknown; active?: unknown } | null;
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) return errorResponse("Modelo inválido.");
  const name = body?.name === undefined ? undefined : String(body.name).trim().replace(/\s+/g, " ");
  const active = body?.active === undefined ? undefined : Boolean(body.active);
  if (name !== undefined && (name.length < 2 || name.length > 80)) return errorResponse("Informe um modelo entre 2 e 80 caracteres.");
  if (name === undefined && active === undefined) return errorResponse("Nenhuma alteração informada.");
  try {
    const db = await ensureMachineModelsStorage();
    const [updated] = await db.update(machineModels).set({ ...(name === undefined ? {} : { name }), ...(active === undefined ? {} : { active }), updatedAt: new Date().toISOString() }).where(eq(machineModels.id, id)).returning();
    if (!updated) return errorResponse("Modelo não encontrado.", 404);
    return Response.json({ model: { id: updated.id, name: updated.name, active: updated.active } });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Não foi possível atualizar o modelo.", 500);
  }
}

export async function DELETE(request: Request) {
  const profile = await getAccessProfile();
  if (!profile || !canManage(profile)) return errorResponse("Somente ADM e Gestão Global podem alterar a base de modelos.", 403);
  const body = await request.json().catch(() => null) as { id?: unknown } | null;
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) return errorResponse("Modelo inválido.");
  try {
    const db = await ensureMachineModelsStorage();
    const [updated] = await db.update(machineModels).set({ active: false, updatedAt: new Date().toISOString() }).where(eq(machineModels.id, id)).returning();
    if (!updated) return errorResponse("Modelo não encontrado.", 404);
    return Response.json({ model: { id: updated.id, name: updated.name, active: updated.active } });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Não foi possível excluir o modelo.", 500);
  }
}

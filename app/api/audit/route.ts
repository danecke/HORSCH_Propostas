import { desc } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLogs } from "../../../db/schema";
import { getAccessProfile } from "../../../lib/access";

export const dynamic = "force-dynamic";

export async function GET() {
  const profile = await getAccessProfile();
  if (!profile) return Response.json({ error: "Acesso não autorizado." }, { status: 403 });
  if (profile.role !== "general_admin") return Response.json({ error: "Somente o ADM Geral pode visualizar o histórico." }, { status: 403 });
  try {
    const db = await getDb();
    const rows = await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt), desc(auditLogs.id)).limit(500);
    return Response.json({ entries: rows });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Não foi possível carregar o histórico." }, { status: 500 });
  }
}

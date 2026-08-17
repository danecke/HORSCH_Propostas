import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../db";
import {
  priceListNotificationRecipients,
  priceListNotifications,
} from "../../../db/schema";
import { getAccessProfile, isModuleEnabled } from "../../../lib/access";
import { recordAudit } from "../../../lib/audit";
import {
  createPriceListNotification,
  getPriceListAudience,
} from "../../../lib/price-list-notifications";

export const dynamic = "force-dynamic";

function errorResponse(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function canManage(profile: NonNullable<Awaited<ReturnType<typeof getAccessProfile>>>) {
  return ["general_admin", "global_management"].includes(profile.role);
}

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

async function canViewPriceListNotifications(
  db: Awaited<ReturnType<typeof getDb>>,
  profile: NonNullable<Awaited<ReturnType<typeof getAccessProfile>>>,
) {
  if (["general_admin", "global_management", "factory_manager"].includes(profile.role)) return true;
  return profile.dealershipId !== null && await isModuleEnabled(db, profile.dealershipId, "price_list");
}

export async function GET(request: Request) {
  const profile = await getAccessProfile();
  if (!profile) return errorResponse("Acesso não autorizado.", 403);

  try {
    const db = await getDb();
    if (!(await canViewPriceListNotifications(db, profile))) {
      return errorResponse("O módulo Lista de preços não está habilitado para este acesso.", 403);
    }
    const includeAudience = new URL(request.url).searchParams.get("audience") === "1" && canManage(profile);
    const [rows, unreadRows, audience] = await Promise.all([
      db
        .select({
          notification: priceListNotifications,
          readAt: priceListNotificationRecipients.readAt,
        })
        .from(priceListNotificationRecipients)
        .innerJoin(priceListNotifications, eq(priceListNotificationRecipients.notificationId, priceListNotifications.id))
        .where(eq(priceListNotificationRecipients.recipientEmail, profile.email))
        .orderBy(desc(priceListNotifications.createdAt), desc(priceListNotifications.id))
        .limit(50),
      db
        .select({ id: priceListNotificationRecipients.id })
        .from(priceListNotificationRecipients)
        .where(and(
          eq(priceListNotificationRecipients.recipientEmail, profile.email),
          isNull(priceListNotificationRecipients.readAt),
        )),
      includeAudience ? getPriceListAudience(db) : Promise.resolve([]),
    ]);

    return Response.json({
      canManage: canManage(profile),
      unreadCount: unreadRows.length,
      notifications: rows.map(({ notification, readAt }) => ({
        id: notification.id,
        title: notification.title,
        message: notification.message,
        effectiveAt: notification.effectiveAt,
        affectedPns: notification.affectedPns,
        audience: notification.audience,
        createdByName: notification.createdByName,
        createdAt: notification.createdAt,
        readAt,
      })),
      audience: includeAudience ? audience : [],
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Não foi possível carregar os avisos.", 500);
  }
}

export async function POST(request: Request) {
  const profile = await getAccessProfile();
  if (!profile) return errorResponse("Acesso não autorizado.", 403);
  if (!canManage(profile)) return errorResponse("Somente ADM Geral e Gestão Global podem enviar avisos.", 403);

  try {
    const payload = (await request.json()) as {
      title?: string;
      message?: string;
      effectiveAt?: string;
      affectedPns?: string;
      audience?: "all" | "selected";
      selectedEmails?: string[];
    };
    const title = String(payload.title ?? "").trim();
    const message = String(payload.message ?? "").trim();
    const effectiveAt = String(payload.effectiveAt ?? "").trim();
    const affectedPns = String(payload.affectedPns ?? "").trim();
    const audience = payload.audience === "selected" ? "selected" : "all";
    const selectedEmails = Array.isArray(payload.selectedEmails)
      ? [...new Set(payload.selectedEmails.filter((email): email is string => typeof email === "string").map((email) => email.trim().toLowerCase()).filter(Boolean))]
      : [];

    if (!title || title.length > 120) return errorResponse("Informe um título de até 120 caracteres.");
    if (!message || message.length > 2000) return errorResponse("Informe uma mensagem de até 2.000 caracteres.");
    if (!isValidDate(effectiveAt)) return errorResponse("Informe uma data de vigência válida.");
    if (affectedPns.length > 500) return errorResponse("O campo de PNs/escopo aceita até 500 caracteres.");
    if (audience === "selected" && !selectedEmails.length) return errorResponse("Selecione pelo menos um usuário para o envio individual.");

    const db = await getDb();
    const created = await createPriceListNotification(db, {
      title,
      message,
      effectiveAt,
      affectedPns,
      audience,
      selectedEmails,
      createdByEmail: profile.email,
      createdByName: profile.name,
    });
    await recordAudit(db, {
      actorEmail: profile.email,
      actorName: profile.name,
      action: "price_list_notification_created",
      entity: "price_list",
      details: "Aviso da lista de preços enviado para " + created.recipientCount + " usuário(s).",
      after: { title, effectiveAt, affectedPns, audience, recipientCount: created.recipientCount },
    });
    return Response.json({ ok: true, notification: created }, { status: 201 });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Não foi possível enviar o aviso.", 500);
  }
}

export async function PATCH(request: Request) {
  const profile = await getAccessProfile();
  if (!profile) return errorResponse("Acesso não autorizado.", 403);

  try {
    const db = await getDb();
    if (!(await canViewPriceListNotifications(db, profile))) {
      return errorResponse("O módulo Lista de preços não está habilitado para este acesso.", 403);
    }
    const payload = (await request.json()) as { id?: number; all?: boolean };
    const now = new Date().toISOString();
    if (payload.all) {
      await db
        .update(priceListNotificationRecipients)
        .set({ readAt: now })
        .where(and(
          eq(priceListNotificationRecipients.recipientEmail, profile.email),
          isNull(priceListNotificationRecipients.readAt),
        ));
      return Response.json({ ok: true });
    }

    const id = Math.trunc(Number(payload.id) || 0);
    if (!id) return errorResponse("Informe o aviso que será marcado como lido.");
    await db
      .update(priceListNotificationRecipients)
      .set({ readAt: now })
      .where(and(
        eq(priceListNotificationRecipients.id, id),
        eq(priceListNotificationRecipients.recipientEmail, profile.email),
      ));
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Não foi possível atualizar o aviso.", 500);
  }
}

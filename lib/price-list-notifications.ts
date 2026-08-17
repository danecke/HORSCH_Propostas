import { eq } from "drizzle-orm";
import { getDb } from "../db";
import {
  dealershipModuleAccess,
  dealerships,
  priceListNotificationRecipients,
  priceListNotifications,
  users,
} from "../db/schema";
import { normalizeUserRole, roleLabel, type UserRole } from "./access";

type Database = Awaited<ReturnType<typeof getDb>>;

export type PriceListAudienceUser = {
  email: string;
  name: string;
  role: UserRole;
  roleLabel: string;
  dealershipId: number | null;
  dealershipName: string;
};

export type CreatePriceListNotificationInput = {
  title: string;
  message: string;
  effectiveAt: string;
  affectedPns: string;
  audience: "all" | "selected";
  selectedEmails?: string[];
  createdByEmail: string;
  createdByName: string;
};

const RECIPIENT_INSERT_BATCH_SIZE = 16;

export async function getPriceListAudience(db: Database): Promise<PriceListAudienceUser[]> {
  const [rows, moduleRows] = await Promise.all([
    db
      .select({
        user: users,
        dealershipName: dealerships.name,
      })
      .from(users)
      .leftJoin(dealerships, eq(users.dealershipId, dealerships.id))
      .where(eq(users.active, true))
      .orderBy(users.name, users.email),
    db
      .select({
        dealershipId: dealershipModuleAccess.dealershipId,
        enabled: dealershipModuleAccess.enabled,
      })
      .from(dealershipModuleAccess)
      .where(eq(dealershipModuleAccess.moduleKey, "price_list")),
  ]);

  const moduleByDealership = new Map(moduleRows.map((row) => [row.dealershipId, row.enabled]));
  return rows.flatMap(({ user, dealershipName }) => {
    const role = normalizeUserRole(user.email, user.role);
    if (!role) return [];
    const hasPriceListAccess =
      ["general_admin", "global_management", "factory_manager"].includes(role) ||
      (user.dealershipId !== null && (moduleByDealership.get(user.dealershipId) ?? true));
    if (!hasPriceListAccess) return [];
    return [{
      email: user.email.trim().toLowerCase(),
      name: user.name || user.email,
      role,
      roleLabel: roleLabel(role),
      dealershipId: user.dealershipId ?? null,
      dealershipName: dealershipName || "",
    }];
  });
}

export async function createPriceListNotification(
  db: Database,
  input: CreatePriceListNotificationInput,
) {
  const audience = await getPriceListAudience(db);
  const selected = new Set((input.selectedEmails ?? []).map((email) => email.trim().toLowerCase()));
  const recipients = input.audience === "all"
    ? audience
    : audience.filter((user) => selected.has(user.email));
  if (!recipients.length) {
    throw new Error("Nenhum usuário ativo com acesso à lista de preços foi selecionado.");
  }

  const now = new Date().toISOString();
  const [created] = await db
    .insert(priceListNotifications)
    .values({
      title: input.title,
      message: input.message,
      effectiveAt: input.effectiveAt,
      affectedPns: input.affectedPns,
      audience: input.audience,
      createdByEmail: input.createdByEmail,
      createdByName: input.createdByName,
      createdAt: now,
    })
    .returning({ id: priceListNotifications.id });
  if (!created) throw new Error("Não foi possível registrar o aviso.");

  try {
    for (let index = 0; index < recipients.length; index += RECIPIENT_INSERT_BATCH_SIZE) {
      const chunk = recipients.slice(index, index + RECIPIENT_INSERT_BATCH_SIZE);
      await db.insert(priceListNotificationRecipients).values(chunk.map((recipient) => ({
        notificationId: created.id,
        recipientEmail: recipient.email,
        recipientName: recipient.name,
        createdAt: now,
      })));
    }
  } catch (error) {
    await db.delete(priceListNotificationRecipients).where(eq(priceListNotificationRecipients.notificationId, created.id));
    await db.delete(priceListNotifications).where(eq(priceListNotifications.id, created.id));
    throw error;
  }

  return { id: created.id, recipientCount: recipients.length };
}

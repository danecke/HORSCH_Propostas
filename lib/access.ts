import { eq } from "drizzle-orm";
import { getChatGPTUser } from "../app/chatgpt-auth";
import { getDb } from "../db";
import { users } from "../db/schema";

export const ROLES = ["admin", "factory_manager", "dealer_manager"] as const;
export type UserRole = (typeof ROLES)[number];

export type AccessProfile = {
  email: string;
  name: string;
  role: UserRole;
  dealershipId: number | null;
  active: boolean;
};

export async function getAccessProfile(): Promise<AccessProfile | null> {
  const identity = await getChatGPTUser();
  if (!identity) return null;

  const db = await getDb();
  const email = identity.email.trim().toLowerCase();
  let [record] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  if (!record) {
    const [existingUser] = await db.select({ email: users.email }).from(users).limit(1);
    if (!existingUser) {
      try {
        await db.insert(users).values({
          email,
          name: identity.displayName,
          role: "admin",
          active: true,
          createdByEmail: email,
        });
      } catch {
        // Outro primeiro acesso pode ter concluído o bootstrap simultaneamente.
      }
      [record] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    }
  }

  if (!record || !record.active || !ROLES.includes(record.role as UserRole)) {
    return null;
  }

  return {
    email: record.email,
    name: record.name || identity.displayName,
    role: record.role as UserRole,
    dealershipId: record.dealershipId ?? null,
    active: record.active,
  };
}

export function canCreateProposal(profile: AccessProfile) {
  return profile.role === "admin" || profile.role === "factory_manager";
}

export function roleLabel(role: UserRole) {
  if (role === "admin") return "ADM";
  if (role === "factory_manager") return "Gestor Fábrica";
  return "Gestor Concessionária";
}

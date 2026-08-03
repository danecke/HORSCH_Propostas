import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { users } from "../db/schema";
import { getAuthenticatedUser } from "./auth";

export const MASTER_ADMIN_EMAIL = "mateus.mazieiro@horsch.com";
export const ROLES = ["admin", "factory_manager", "dealer_manager", "user"] as const;
export type UserRole = (typeof ROLES)[number];

export type AccessProfile = {
  email: string;
  name: string;
  role: UserRole;
  dealershipId: number | null;
  active: boolean;
};

export async function getAccessProfile(): Promise<AccessProfile | null> {
  const identity = await getAuthenticatedUser();
  if (!identity) return null;

  const db = await getDb();
  const email = identity.email.trim().toLowerCase();
  const [record] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  const role = record ? normalizeUserRole(record.email, record.role) : null;
  if (!record || !record.active || !role) {
    return null;
  }

  return {
    email: record.email,
    name: record.name || identity.displayName,
    role,
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
  if (role === "dealer_manager") return "Gestor Concessionária";
  return "Usuário comum";
}

export function normalizeUserRole(email: string, role: string): UserRole | null {
  const normalizedEmail = email.trim().toLowerCase();
  if (normalizedEmail === MASTER_ADMIN_EMAIL) return "admin";
  if (role === "admin") return "user";
  return ROLES.includes(role as UserRole) ? (role as UserRole) : null;
}

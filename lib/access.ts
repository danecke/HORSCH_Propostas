import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { users } from "../db/schema";
import { getAuthenticatedUser } from "./auth";

export const MASTER_ADMIN_EMAIL = "mateus.mazieiro@horsch.com";
export const ROLES = [
  "general_admin",
  "global_management",
  "factory_manager",
  "dealer_manager",
  "concession",
] as const;
export const PROPOSAL_RESPONSIBLE_ROLES = [
  "general_admin",
  "global_management",
  "factory_manager",
] as const;
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
  return ["general_admin", "global_management", "factory_manager"].includes(profile.role);
}

export function canBeProposalResponsible(role: UserRole) {
  return PROPOSAL_RESPONSIBLE_ROLES.includes(role as (typeof PROPOSAL_RESPONSIBLE_ROLES)[number]);
}

export function roleLabel(role: UserRole) {
  if (role === "general_admin") return "ADM Geral";
  if (role === "global_management") return "Gestão Global";
  if (role === "factory_manager") return "Gestor Fábrica";
  if (role === "dealer_manager") return "Gestor Concessionária";
  return "Concessão";
}

export function normalizeUserRole(email: string, role: string): UserRole | null {
  const normalizedEmail = email.trim().toLowerCase();
  if (normalizedEmail === MASTER_ADMIN_EMAIL) return "general_admin";
  if (role === "admin") return "concession";
  if (role === "user") return "concession";
  return ROLES.includes(role as UserRole) ? (role as UserRole) : null;
}

import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { dealershipModuleAccess, users } from "../db/schema";
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

export const MODULE_KEYS = ["proposals", "quotes", "price_list"] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];
export const MODULE_LABELS: Record<ModuleKey, string> = {
  proposals: "Propostas",
  quotes: "Cotações",
  price_list: "Lista de preços",
};

export const LOWER_MANAGED_ROLES: Record<UserRole, readonly UserRole[]> = {
  general_admin: ROLES,
  global_management: ["factory_manager", "dealer_manager", "concession"],
  factory_manager: ["dealer_manager", "concession"],
  dealer_manager: [],
  concession: [],
};

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

export function canManageLowerRole(actorRole: UserRole, targetRole: UserRole) {
  return LOWER_MANAGED_ROLES[actorRole].includes(targetRole);
}

export function canManageAccess(actorRole: UserRole) {
  return ["general_admin", "global_management", "factory_manager"].includes(actorRole);
}

export function canRestorePassword(actorRole: UserRole, targetRole: UserRole) {
  return actorRole === "general_admin" || canManageLowerRole(actorRole, targetRole);
}

export function rolePermissions(role: UserRole) {
  return {
    viewAll: ["general_admin", "global_management"].includes(role),
    viewPriceList: true,
    requestQuote: role === "dealer_manager",
    respondQuote: ["general_admin", "global_management"].includes(role),
    createProposal: ["general_admin", "global_management", "factory_manager"].includes(role),
    editPriceList: ["general_admin", "global_management"].includes(role),
    publishPriceList: ["general_admin", "global_management"].includes(role),
    manageDSH: ["general_admin", "global_management", "factory_manager", "dealer_manager"].includes(role),
    createCampaign: ["general_admin", "global_management"].includes(role),
    analyzeQuotes: ["general_admin", "global_management", "factory_manager"].includes(role),
    viewOpenQuotes: ["general_admin", "global_management", "factory_manager", "dealer_manager"].includes(role),
    approveQuoteReturn: ["general_admin", "dealer_manager"].includes(role),
    placeOrder: ["general_admin", "factory_manager"].includes(role),
    manageAccess: canManageAccess(role),
    manageAllAccess: role === "general_admin",
    assignLowerPermission: ["general_admin", "global_management", "factory_manager"].includes(role),
    restoreLowerPassword: ["general_admin", "global_management", "factory_manager"].includes(role),
    decideProposal: ["general_admin", "global_management", "dealer_manager"].includes(role),
    deleteAnyProposal: role === "general_admin",
    deleteOwnDraft: ["global_management", "factory_manager"].includes(role),
  };
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

export async function isModuleEnabled(
  db: Awaited<ReturnType<typeof getDb>>,
  dealershipId: number,
  moduleKey: ModuleKey,
) {
  const [access] = await db
    .select({ enabled: dealershipModuleAccess.enabled })
    .from(dealershipModuleAccess)
    .where(and(
      eq(dealershipModuleAccess.dealershipId, dealershipId),
      eq(dealershipModuleAccess.moduleKey, moduleKey),
    ))
    .limit(1);
  return access?.enabled ?? true;
}

export async function ensureDealershipModules(
  db: Awaited<ReturnType<typeof getDb>>,
  dealershipId: number,
  updatedByEmail = "",
) {
  const now = new Date().toISOString();
  for (const moduleKey of MODULE_KEYS) {
    await db.insert(dealershipModuleAccess).values({
      dealershipId,
      moduleKey,
      enabled: true,
      updatedByEmail,
      updatedAt: now,
    }).onConflictDoNothing({
      target: [dealershipModuleAccess.dealershipId, dealershipModuleAccess.moduleKey],
    });
  }
}

import { getDb } from "../db";
import { auditLogs } from "../db/schema";

type AuditDatabase = Awaited<ReturnType<typeof getDb>>;

export type AuditInput = {
  proposalId?: string | null;
  actorEmail: string;
  actorName: string;
  action: string;
  entity: string;
  details: string;
  before?: unknown;
  after?: unknown;
};

function snapshot(value: unknown) {
  return value === undefined || value === null ? "" : JSON.stringify(value);
}

export async function recordAudit(db: AuditDatabase, input: AuditInput) {
  await db.insert(auditLogs).values({
    proposalId: input.proposalId ?? null,
    actorEmail: input.actorEmail,
    actorName: input.actorName,
    action: input.action,
    entity: input.entity,
    details: input.details,
    beforeJson: snapshot(input.before),
    afterJson: snapshot(input.after),
    createdAt: new Date().toISOString(),
  });
}

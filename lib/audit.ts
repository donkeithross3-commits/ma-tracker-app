import { prisma } from "@/lib/db";

export type AuditAction = "create" | "update" | "delete";

export async function createAuditLog({
  entityType,
  entityId,
  action,
  oldValues,
  newValues,
  userId,
}: {
  entityType: string;
  entityId: string;
  action: AuditAction;
  oldValues?: Record<string, any>;
  newValues?: Record<string, any>;
  userId?: string;
}) {
  // Calculate changed fields
  const changedFields: string[] = [];

  if (action === "update" && oldValues && newValues) {
    Object.keys(newValues).forEach((key) => {
      if (JSON.stringify(oldValues[key]) !== JSON.stringify(newValues[key])) {
        changedFields.push(key);
      }
    });
  }

  await prisma.auditLog.create({
    data: {
      entityType,
      entityId,
      action,
      changedFields: changedFields.length > 0 ? JSON.stringify(changedFields) : null,
      oldValues: oldValues ? JSON.stringify(oldValues) : null,
      newValues: newValues ? JSON.stringify(newValues) : null,
      createdById: userId || null,
    },
  });
}

export async function getAuditLogs(entityType: string, entityId: string) {
  return await prisma.auditLog.findMany({
    where: {
      entityType,
      entityId,
    },
    include: {
      createdBy: {
        select: {
          username: true,
          fullName: true,
          email: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

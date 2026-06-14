import type { Group } from "./relayer";

export type GroupNotification = {
  groupId: string;
  groupName: string;
  createdAt: number;
  readAt: number | null;
};

export function parseStoredGroupNotifications(raw: string | null): GroupNotification[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((value): value is GroupNotification => {
        if (!value || typeof value !== "object") return false;
        const candidate = value as Partial<GroupNotification>;
        return typeof candidate.groupId === "string"
          && typeof candidate.groupName === "string"
          && typeof candidate.createdAt === "number"
          && Number.isFinite(candidate.createdAt)
          && (candidate.readAt === null || (typeof candidate.readAt === "number" && Number.isFinite(candidate.readAt)));
      })
      .slice(0, 50);
  } catch {
    return [];
  }
}

export function parseStoredStringArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
}

export function mergeGroupNotifications(
  current: GroupNotification[],
  groups: Group[],
  firstSync: boolean,
  seenGroupIds: Set<string>,
  now = Date.now(),
): GroupNotification[] {
  const byGroup = new Map(current.map((entry) => [entry.groupId, entry]));
  for (const group of groups) {
    const existing = byGroup.get(group.id);
    if (existing) {
      if (existing.groupName !== group.name) {
        byGroup.set(group.id, { ...existing, groupName: group.name });
      }
      continue;
    }
    byGroup.set(group.id, {
      groupId: group.id,
      groupName: group.name,
      createdAt: typeof group.updatedAt === "number" && Number.isFinite(group.updatedAt) ? group.updatedAt : now,
      readAt: firstSync || seenGroupIds.has(group.id) ? now : null,
    });
  }
  return Array.from(byGroup.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 50);
}

export function countUnreadGroupNotifications(notifications: GroupNotification[]): number {
  return notifications.reduce((sum, entry) => sum + (entry.readAt ? 0 : 1), 0);
}

export function markAllGroupNotificationsRead(
  notifications: GroupNotification[],
  readAt = Date.now(),
): { notifications: GroupNotification[]; changed: boolean } {
  let changed = false;
  const next = notifications.map((entry) => {
    if (entry.readAt) return entry;
    changed = true;
    return { ...entry, readAt };
  });
  return { notifications: next, changed };
}

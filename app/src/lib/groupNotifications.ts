import type { Group } from "./relayer";
export type GroupNotificationType = "added" | "left";

export type GroupNotification = {
  groupId: string;
  groupName: string;
  createdAt: number;
  readAt: number | null;
  type: GroupNotificationType;
};

export function parseStoredGroupNotifications(raw: string | null): GroupNotification[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((value): GroupNotification | null => {
        if (!value || typeof value !== "object") return null;
        const candidate = value as Partial<GroupNotification>;
        if (typeof candidate.groupId !== "string"
          || typeof candidate.groupName !== "string"
          || typeof candidate.createdAt !== "number"
          || !Number.isFinite(candidate.createdAt)
          || (candidate.readAt !== null && (typeof candidate.readAt !== "number" || !Number.isFinite(candidate.readAt)))) {
          return null;
        }
        if (candidate.type !== undefined && candidate.type !== "added" && candidate.type !== "left") {
          return null;
        }
        return {
          groupId: candidate.groupId,
          groupName: candidate.groupName,
          createdAt: candidate.createdAt,
          readAt: candidate.readAt,
          type: candidate.type ?? "added",
        };
      })
      .filter((value): value is GroupNotification => value !== null)
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
  const activeGroupIds = new Set<string>();
  for (const group of groups) {
    activeGroupIds.add(group.id);
    const existing = byGroup.get(group.id);
    const createdAt = typeof group.updatedAt === "number" && Number.isFinite(group.updatedAt) ? group.updatedAt : now;
    if (existing) {
      if (existing.groupName !== group.name || existing.type === "left") {
        byGroup.set(group.id, {
          ...existing,
          groupName: group.name,
          type: "added",
          createdAt: existing.type === "left" ? createdAt : existing.createdAt,
          readAt: existing.type === "left" ? (firstSync ? now : null) : existing.readAt,
        });
      }
      continue;
    }
    byGroup.set(group.id, {
      groupId: group.id,
      groupName: group.name,
      createdAt,
      readAt: firstSync || seenGroupIds.has(group.id) ? now : null,
      type: "added",
    });
  }
  for (const [groupId, existing] of byGroup) {
    if (activeGroupIds.has(groupId) || existing.type === "left") continue;
    byGroup.set(groupId, {
      ...existing,
      type: "left",
      createdAt: now,
      readAt: null,
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

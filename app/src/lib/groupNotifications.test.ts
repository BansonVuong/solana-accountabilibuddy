import { describe, expect, it } from "vitest";
import {
  countUnreadGroupNotifications,
  markAllGroupNotificationsRead,
  mergeGroupNotifications,
  parseStoredGroupNotifications,
  parseStoredStringArray,
  type GroupNotification,
} from "./groupNotifications";

describe("group notification storage parsing", () => {
  it("returns an empty list for invalid JSON", () => {
    expect(parseStoredGroupNotifications("{bad json")).toEqual([]);
  });

  it("keeps only valid notification entries", () => {
    const raw = JSON.stringify([
      { groupId: "g-1", groupName: "Alpha", createdAt: 100, readAt: null },
      { groupId: "g-2", groupName: "Beta", createdAt: 200, readAt: 250 },
      { groupId: "g-3", groupName: "Gamma", createdAt: "oops", readAt: null },
      { groupId: 123, groupName: "Delta", createdAt: 300, readAt: null },
    ]);
    expect(parseStoredGroupNotifications(raw)).toEqual([
      { groupId: "g-1", groupName: "Alpha", createdAt: 100, readAt: null },
      { groupId: "g-2", groupName: "Beta", createdAt: 200, readAt: 250 },
    ]);
  });

  it("parses only string items for generic stored arrays", () => {
    const raw = JSON.stringify(["g-1", 2, "g-3", null, { id: "g-4" }]);
    expect(parseStoredStringArray(raw)).toEqual(["g-1", "g-3"]);
  });
});

describe("group notification merging", () => {
  it("marks first-sync groups as read", () => {
    const merged = mergeGroupNotifications(
      [],
      [{ id: "g-1", name: "Alpha", updatedAt: 1200, initials: "A", members: 1, pendingBet: false, lastMsg: "", time: "" }],
      true,
      new Set<string>(),
      5000,
    );
    expect(merged).toEqual([
      { groupId: "g-1", groupName: "Alpha", createdAt: 1200, readAt: 5000 },
    ]);
  });

  it("creates unread notifications when a new unseen group appears", () => {
    const current: GroupNotification[] = [
      { groupId: "g-1", groupName: "Alpha", createdAt: 1000, readAt: 2000 },
    ];
    const merged = mergeGroupNotifications(
      current,
      [
        { id: "g-1", name: "Alpha", updatedAt: 1100, initials: "A", members: 1, pendingBet: false, lastMsg: "", time: "" },
        { id: "g-2", name: "Beta", updatedAt: 1200, initials: "B", members: 1, pendingBet: false, lastMsg: "", time: "" },
      ],
      false,
      new Set(["g-1"]),
      9000,
    );
    expect(merged).toEqual([
      { groupId: "g-2", groupName: "Beta", createdAt: 1200, readAt: null },
      { groupId: "g-1", groupName: "Alpha", createdAt: 1000, readAt: 2000 },
    ]);
  });

  it("updates existing notification group names without resetting read state", () => {
    const current: GroupNotification[] = [
      { groupId: "g-1", groupName: "Old Name", createdAt: 1000, readAt: 2000 },
    ];
    const merged = mergeGroupNotifications(
      current,
      [{ id: "g-1", name: "New Name", updatedAt: 3000, initials: "N", members: 1, pendingBet: false, lastMsg: "", time: "" }],
      false,
      new Set(["g-1"]),
      5000,
    );
    expect(merged).toEqual([
      { groupId: "g-1", groupName: "New Name", createdAt: 1000, readAt: 2000 },
    ]);
  });
});

describe("group notification unread logic", () => {
  it("counts only unread entries for the red dot indicator", () => {
    const notifications: GroupNotification[] = [
      { groupId: "g-1", groupName: "Alpha", createdAt: 1000, readAt: null },
      { groupId: "g-2", groupName: "Beta", createdAt: 1000, readAt: 1200 },
      { groupId: "g-3", groupName: "Gamma", createdAt: 1000, readAt: null },
    ];
    expect(countUnreadGroupNotifications(notifications)).toBe(2);
  });

  it("marks unread notifications as read and clears unread count", () => {
    const notifications: GroupNotification[] = [
      { groupId: "g-1", groupName: "Alpha", createdAt: 1000, readAt: null },
      { groupId: "g-2", groupName: "Beta", createdAt: 1000, readAt: 1400 },
    ];
    const { notifications: next, changed } = markAllGroupNotificationsRead(notifications, 3000);
    expect(changed).toBe(true);
    expect(next).toEqual([
      { groupId: "g-1", groupName: "Alpha", createdAt: 1000, readAt: 3000 },
      { groupId: "g-2", groupName: "Beta", createdAt: 1000, readAt: 1400 },
    ]);
    expect(countUnreadGroupNotifications(next)).toBe(0);
  });

  it("returns unchanged when everything is already read", () => {
    const notifications: GroupNotification[] = [
      { groupId: "g-1", groupName: "Alpha", createdAt: 1000, readAt: 1100 },
    ];
    const { notifications: next, changed } = markAllGroupNotificationsRead(notifications, 3000);
    expect(changed).toBe(false);
    expect(next).toEqual(notifications);
  });
});

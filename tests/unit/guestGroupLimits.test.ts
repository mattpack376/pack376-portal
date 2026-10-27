import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADMIN_GUEST_GROUP_MAX_PEOPLE,
  SELF_SERVICE_GUEST_GROUP_MAX_PEOPLE,
  SELF_SERVICE_GUEST_GROUPS_PER_EVENT,
  adminGuestGroupEditMaxPeople,
  isSubmissionKey,
  newSubmissionKey,
} from "@/lib/guestGroupLimits";

describe("guest group limits", () => {
  it("are the ones the pack set: 10 people online, 5 groups per login per event, 200 by an Admin", () => {
    assert.equal(SELF_SERVICE_GUEST_GROUP_MAX_PEOPLE, 10);
    assert.equal(SELF_SERVICE_GUEST_GROUPS_PER_EVENT, 5);
    assert.equal(ADMIN_GUEST_GROUP_MAX_PEOPLE, 200);
  });

  it("let an Admin's edit keep an older, bigger group's size, but no more", () => {
    assert.equal(adminGuestGroupEditMaxPeople(3), 200);
    assert.equal(adminGuestGroupEditMaxPeople(200), 200);
    assert.equal(adminGuestGroupEditMaxPeople(280), 280);
  });
});

describe("submission keys", () => {
  it("are fresh each time and pass their own check", () => {
    const keys = new Set(Array.from({ length: 50 }, newSubmissionKey));
    assert.equal(keys.size, 50);
    for (const key of keys) assert.ok(isSubmissionKey(key), key);
  });

  it("refuse anything that isn't a plain 16-64 character key", () => {
    for (const raw of ["", "short", "x".repeat(65), "has space in it here", "semi;colon-0123456789", "ünïcode-0123456789", "a/b-0123456789abcd"]) {
      assert.equal(isSubmissionKey(raw), false, raw);
    }
    assert.ok(isSubmissionKey("a".repeat(16)));
    assert.ok(isSubmissionKey("A-b-0".repeat(12) + "abcd"));
  });
});

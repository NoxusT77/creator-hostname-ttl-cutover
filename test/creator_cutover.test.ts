import assert from "node:assert/strict";
import test from "node:test";
import { planCreatorCutover } from "../src/creator_cutover.js";

test("uses the short TTL while preserving the creator hostnames for rollback", () => {
  const plan = planCreatorCutover(
    {
      downloads: "assets.new.example.net",
      updates: "mail.new.example.net",
      processing: "media.new.example.net",
    },
    [
      { record_type: "CNAME", name: "downloads", content: "assets.old.example.net", ttl: 3600 },
      { record_type: "CNAME", name: "updates", content: "mail.old.example.net", ttl: 3600 },
      { record_type: "CNAME", name: "processing", content: "media.old.example.net", ttl: 3600 },
      { record_type: "TXT", name: "updates", content: "verification=kept" },
    ],
    60,
  );

  assert.deepEqual(plan.apply.map(({ name, ttl }) => [name, ttl]), [
    ["downloads", 60],
    ["updates", 60],
    ["processing", 60],
  ]);
  assert.deepEqual(plan.rollback.map(({ name, content, ttl }) => [name, content, ttl]), [
    ["downloads", "assets.old.example.net", 3600],
    ["updates", "mail.old.example.net", 3600],
    ["processing", "media.old.example.net", 3600],
  ]);
});

import { assertEquals } from "@std/assert";
import { Whitelist } from "../src/core/whitelist.ts";
import type { WhitelistEntry } from "../src/model/whitelist.ts";

function entry(id: number, label?: string): WhitelistEntry {
  return {
    id: id,
    label: label,
    addedAt: new Date().toISOString(),
    addedBy: 1,
  };
}

Deno.test("Whitelist holds an entry", async () => {
  using kv = await Deno.openKv(":memory:");
  const whitelist = new Whitelist(kv);

  assertEquals(await whitelist.has(42), false, "unknown ID is absent");
  assertEquals(await whitelist.add(entry(42, "Friend")), true, "ID is added");
  assertEquals(await whitelist.has(42), true, "added ID is present");
});

Deno.test("Whitelist reports a repeated add", async () => {
  using kv = await Deno.openKv(":memory:");
  const whitelist = new Whitelist(kv);

  assertEquals(await whitelist.add(entry(42)), true, "first add succeeds");
  assertEquals(await whitelist.add(entry(42)), false, "second add is a repeat");
});

Deno.test("Whitelist removes an entry", async () => {
  using kv = await Deno.openKv(":memory:");
  const whitelist = new Whitelist(kv);

  assertEquals(await whitelist.remove(42), false, "unknown ID removes nothing");

  await whitelist.add(entry(42));

  assertEquals(await whitelist.remove(42), true, "known ID is removed");
  assertEquals(await whitelist.has(42), false, "removed ID is absent");
});

Deno.test("Whitelist lists every entry", async () => {
  using kv = await Deno.openKv(":memory:");
  const whitelist = new Whitelist(kv);

  await whitelist.add(entry(42, "Friend"));
  await whitelist.add(entry(-100, "Group"));

  const ids = (await whitelist.list()).map((it) => it.id);

  assertEquals(
    ids.toSorted((a, b) => a - b),
    [-100, 42],
    "both IDs are listed",
  );
});

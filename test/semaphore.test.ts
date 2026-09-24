import { assertEquals } from "@std/assert";
import { Semaphore } from "../src/utils/semaphore.ts";

Deno.test("Semaphore never runs more tasks than its limit", async () => {
  const semaphore = new Semaphore(2);
  let running = 0;
  let peak = 0;

  const task = () =>
    semaphore.run(async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 10));
      running--;
    });

  await Promise.all(Array.from({ length: 6 }, task));

  assertEquals(peak, 2);
  assertEquals(semaphore.isFull, false, "all slots are free again");
});

Deno.test("Semaphore frees the slot of a failed task", async () => {
  const semaphore = new Semaphore(1);

  await semaphore.run(() => Promise.reject(new Error("boom"))).catch(() => {});

  assertEquals(await semaphore.run(() => Promise.resolve("ran")), "ran");
});

/// <reference lib="deno.unstable" />

import { resolve } from "@std/path";
import { config } from "./config.ts";
import { Whitelist } from "./whitelist.ts";

const dbPath = config.DATA_DIR
  ? resolve(config.DATA_DIR, "kv.sqlite3")
  : undefined;

const kv = await Deno.openKv(dbPath);

export const db = {
  instagram: {
    cookie: createModel<string>(["instagram", "cookie"]),
  },
  whitelist: new Whitelist(kv),
};

/**
 * This function allows us to create a DB layer that:
 * 1. Decouples the DB implementation (Deno KV) from the business logic
 * 2. Provides a standardized interface for managing data
 */
function createModel<T>(key: string[]) {
  const dinogramKey = ["dinogram", ...key];

  return {
    set: (value: T) => kv.set(dinogramKey, value),
    get: () => kv.get<T>(dinogramKey).then(({ value }) => value),
    delete: () => kv.delete(dinogramKey),
  };
}

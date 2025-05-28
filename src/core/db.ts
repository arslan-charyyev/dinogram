/// <reference lib="deno.unstable" />

import { resolve } from "@std/path";
import { config } from "./config.ts";

export const db = {
  instagram: {
    cookie: createModel<string>({
      keys: ["instagram", "cookie"],
      default: "",
    }),
  },
};

const dbPath = config.DATA_DIR
  ? resolve(config.DATA_DIR, "kv.sqlite3")
  : undefined;

const kv = await Deno.openKv(dbPath);

/**
 * This function allows us to create a DB layer that:
 * 1. Decouples the DB implementation (Deno KV) from the business logic
 * 2. Provides a standardized interface for managing data
 */
export function createModel<T>(options: { keys: string[]; default: T }) {
  const dinogramKey = ["dinogram", ...options.keys];

  const set = (value: T) => kv.set(dinogramKey, value);
  const get = () => kv.get<T>(dinogramKey).then(({ value }) => value);
  const getOrDef = async () => await get() ?? options.default;
  const del = () => kv.delete(dinogramKey);
  return {
    set,
    get,
    getOrDef,
    del,
  };
}

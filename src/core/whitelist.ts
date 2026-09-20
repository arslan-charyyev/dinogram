import type { WhitelistEntry } from "../model/whitelist.ts";

const PREFIX = ["dinogram", "whitelist"];

/**
 * The dynamic list of the users and the chats that may use the bot. It lives in
 * Deno KV, so an admin changes it with a chat command, and the change outlives
 * a redeploy.
 *
 * The static {@link config.WHITELIST} stays beside it as a seed that the
 * deployment owns.
 */
export class Whitelist {
  constructor(private kv: Deno.Kv) {}

  async has(id: number): Promise<boolean> {
    const { value } = await this.kv.get<WhitelistEntry>([...PREFIX, id]);
    return value !== null;
  }

  /**
   * Returns false when the entry was already there
   */
  async add(entry: WhitelistEntry): Promise<boolean> {
    const key = [...PREFIX, entry.id];
    const { ok } = await this.kv
      .atomic()
      .check({ key, versionstamp: null })
      .set(key, entry)
      .commit();

    return ok;
  }

  /**
   * Returns false when there was no such entry
   */
  async remove(id: number): Promise<boolean> {
    const key = [...PREFIX, id];
    const { value } = await this.kv.get<WhitelistEntry>(key);
    if (value === null) return false;

    await this.kv.delete(key);
    return true;
  }

  async list(): Promise<WhitelistEntry[]> {
    const entries: WhitelistEntry[] = [];
    for await (
      const { value } of this.kv.list<WhitelistEntry>({ prefix: PREFIX })
    ) {
      entries.push(value);
    }
    return entries;
  }
}

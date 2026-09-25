import type { Subscription } from "../model/subscription.ts";

const PREFIX = ["dinogram", "subscriptions"];

/**
 * The YouTube channel subscriptions of the users, keyed by the user and the
 * channel, so that a user has one subscription per channel
 */
export class Subscriptions {
  constructor(private kv: Deno.Kv) {}

  async get(
    userId: number,
    channelId: string,
  ): Promise<Subscription | null> {
    const { value } = await this.kv.get<Subscription>(
      [...PREFIX, userId, channelId],
    );
    return value;
  }

  async set(subscription: Subscription) {
    await this.kv.set(
      [...PREFIX, subscription.userId, subscription.channelId],
      subscription,
    );
  }

  /**
   * Returns false when there was no such subscription
   */
  async remove(userId: number, channelId: string): Promise<boolean> {
    const key = [...PREFIX, userId, channelId];
    const { value } = await this.kv.get<Subscription>(key);
    if (value === null) return false;

    await this.kv.delete(key);
    return true;
  }

  async listByUser(userId: number): Promise<Subscription[]> {
    return await this.list([...PREFIX, userId]);
  }

  async listAll(): Promise<Subscription[]> {
    return await this.list(PREFIX);
  }

  private async list(prefix: Deno.KvKey): Promise<Subscription[]> {
    const subscriptions: Subscription[] = [];
    for await (const { value } of this.kv.list<Subscription>({ prefix })) {
      subscriptions.push(value);
    }
    return subscriptions;
  }
}

/**
 * The file that a subscription sends for each new video
 */
export type SubscriptionFormat = "high" | "medium" | "low" | "audio";

/**
 * How often a subscription sends the videos that it collected
 */
export type SubscriptionFrequency = "instant" | "daily" | "weekly";

/**
 * A video that waits for its delivery
 */
export type PendingVideo = {
  readonly id: string;
  readonly title: string;
  /** Failed delivery attempts, such as a premiere that has not started yet */
  readonly attempts: number;
};

export type Subscription = {
  readonly userId: number;
  /** The private chat with the user, which receives the videos */
  readonly chatId: number;
  readonly channelId: string;
  readonly channelTitle: string;
  readonly format: SubscriptionFormat;
  readonly frequency: SubscriptionFrequency;
  readonly withShorts: boolean;
  /** Epoch milliseconds. Videos from before the subscription never arrive. */
  readonly createdAt: number;
  /** Epoch milliseconds of the last batch; a daily batch waits a day after it */
  readonly lastDeliveredAt: number;
  readonly pending: PendingVideo[];
  /** The newest video IDs that the subscription already knows */
  readonly seen: string[];
};

/**
 * One upload in the RSS feed of a channel
 */
export type FeedEntry = {
  readonly videoId: string;
  readonly title: string;
  /** Epoch milliseconds */
  readonly publishedAt: number;
  readonly isShort: boolean;
};

export type Channel = {
  readonly id: string;
  readonly title: string;
};

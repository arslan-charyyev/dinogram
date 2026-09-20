/**
 * One allowed user or chat. A group is stored by its chat ID, so every member
 * of that group may use the bot.
 */
export type WhitelistEntry = {
  readonly id: number;
  /**
   * The name of the user, or the title of the chat, when Telegram knows it
   */
  readonly label?: string;
  /**
   * An ISO timestamp
   */
  readonly addedAt: string;
  /**
   * The user ID of the admin that added the entry
   */
  readonly addedBy: number;
};

import {
  bold,
  expandableBlockquote,
  fmt,
  FormattedString,
  Stringable,
} from "@grammyjs/parse-mode";
import { config } from "../core/config.ts";
import { messages } from "../core/messages.ts";
import { FilePost, MultiFilePost, SingleFilePost } from "../model/post.ts";
import { truncate } from "../utils/utils.ts";
import { BATCH_SIZE } from "./constants.ts";

export class CaptionBuilder {
  static single(post: SingleFilePost): FormattedString {
    const parts: Stringable[] = [];

    if (config.WITH_CAPTION && post.description.length > 0) {
      parts.push(expandableBlockquote(truncate(post.description, 900)));
    }

    if (!config.SEND_AS_REPLY) {
      parts.push("\n\n", truncate(post.pageUrl.toString(), 100));
    }

    const caption = fmt(parts);

    return caption;
  }

  /**
   * An inline message holds a single media item and no reply, so the caption
   * carries the whole context of the post.
   */
  static inline(post: FilePost): FormattedString {
    const parts: Stringable[] = [];

    if (config.WITH_CAPTION) {
      const title = post.type === "multi" ? post.title : undefined;

      if (title) {
        parts.push(bold(truncate(title, 100)), "\n");
      }

      if (post.description.length > 0 && post.description !== title) {
        parts.push(expandableBlockquote(truncate(post.description, 800)));
      }
    }

    if (post.type === "multi" && post.files.length > 1) {
      parts.push(
        "\n\n",
        `1 out of ${post.files.length} — ${messages.INLINE_MORE_ITEMS}`,
      );
    }

    return fmt(parts);
  }

  static multi(post: MultiFilePost, batchIndex: number): FormattedString {
    const parts: Stringable[] = [];

    // Add caption to the first image
    if (batchIndex == 0) {
      if (config.WITH_CAPTION && post.title) {
        parts.push(bold(truncate(post.title, 100)));
      }

      if (
        config.WITH_CAPTION && post.description &&
        post.description !== post.title
      ) {
        parts.push("\n", expandableBlockquote(truncate(post.description, 800)));
      }

      if (!config.SEND_AS_REPLY) {
        parts.push("\n\n", truncate(post.pageUrl.toString(), 100));
      }
    }

    const totalFileCount = post.files.length;
    if (totalFileCount > BATCH_SIZE) {
      const start = batchIndex * BATCH_SIZE + 1;
      const end = Math.min((batchIndex + 1) * BATCH_SIZE, totalFileCount);
      const current = `${start}` + (start == end ? "" : `–${end}`);

      parts.push(
        "— Pages —\n",
        `${current}  out of  ${totalFileCount}`,
      );
    }

    const caption = fmt(parts);

    return caption;
  }
}

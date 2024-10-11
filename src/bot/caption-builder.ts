import {
  blockquote,
  bold,
  fmt,
  FormattedString,
  Stringable,
} from "@grammyjs/parse-mode";
import { config } from "../core/config.ts";
import { MultiFilePost, SingleFilePost } from "../model/post.ts";
import { truncate } from "../utils/utils.ts";
import { BATCH_SIZE } from "./constants.ts";

export class CaptionBuilder {
  static single(post: SingleFilePost): FormattedString {
    const parts: Stringable[] = [];

    if (config.WITH_CAPTION && post.description.length > 0) {
      parts.push(blockquote(truncate(post.description, 900)));
    }

    if (!config.SEND_AS_REPLY) {
      parts.push("\n\n", truncate(post.pageUrl.toString(), 100));
    }

    const caption = fmt(parts);
    CaptionBuilder.fixExpandableBlockQuotes(caption);

    return caption;
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
        parts.push("\n", blockquote(truncate(post.description, 800)));
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
    CaptionBuilder.fixExpandableBlockQuotes(caption);

    return caption;
  }

  // TODO: Remove once this commit is in prod:
  //   https://github.com/grammyjs/parse-mode/commit/50582c6c65c57d496a0b920b7bd3dd6a54f93be6
  private static fixExpandableBlockQuotes(caption: FormattedString) {
    // A dirty-hack to add support for expandable block-quotes
    // until it is available in the upstream
    for (const entity of caption.entities) {
      if (entity.type === "blockquote") {
        entity.type = "expandable_blockquote";
      }
    }
  }
}

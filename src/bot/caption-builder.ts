import {
  bold,
  expandableBlockquote,
  fmt,
  FormattedString,
  mentionUser,
  Stringable,
} from "@grammyjs/parse-mode";
import type { User } from "@grammyjs/types";
import { YouTubeClient } from "../client/youtube-client.ts";
import { config } from "../core/config.ts";
import { messages } from "../core/messages.ts";
import { FilePost, MultiFilePost, SingleFilePost } from "../model/post.ts";
import type { YouTubeVideo } from "../model/youtube.ts";
import { formatDuration, truncate } from "../utils/utils.ts";
import { BATCH_SIZE } from "./constants.ts";

export class CaptionBuilder {
  /**
   * The menu card shows the video, the state of the menu or the download,
   * and in a group, the member whose download runs
   */
  static youtubeCard(
    video: YouTubeVideo,
    status: string,
    requester?: User,
  ): FormattedString {
    const parts: Stringable[] = [
      bold(truncate(video.title, 200)),
      "\n",
      [video.channel, formatDuration(video.duration)].filter(Boolean).join(
        " · ",
      ),
    ];

    if (!config.SEND_AS_REPLY) {
      parts.push("\n", YouTubeClient.watchUrl(video.id));
    }

    parts.push("\n\n", status);

    if (requester) {
      parts.push(
        "\n",
        messages.YOUTUBE_REQUESTED_BY,
        mentionUser(truncate(requester.first_name, 64), requester.id),
      );
    }

    return fmt(parts);
  }

  /**
   * An inline message has a button to the original video, so it needs no
   * link in the caption
   */
  static youtube(
    video: YouTubeVideo,
    options: { requester?: User; inline?: boolean } = {},
  ): FormattedString {
    const parts: Stringable[] = [];

    if (config.WITH_CAPTION) {
      parts.push(bold(truncate(video.title, 200)));
      if (video.channel) parts.push("\n", video.channel);
    }

    if (options.requester) {
      if (parts.length > 0) parts.push("\n");
      parts.push(
        messages.YOUTUBE_REQUESTED_BY,
        mentionUser(
          truncate(options.requester.first_name, 64),
          options.requester.id,
        ),
      );
    }

    if (!config.SEND_AS_REPLY && !options.inline) {
      if (parts.length > 0) parts.push("\n\n");
      parts.push(YouTubeClient.watchUrl(video.id));
    }

    return fmt(parts);
  }

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

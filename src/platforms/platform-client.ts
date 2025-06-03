import { retry } from "@std/async/retry";
import { BATCH_SIZE } from "../bot/constants.ts";
import { Assets } from "../core/assets.ts";
import { MediaFile } from "../model/file.ts";
import { MediaStream } from "../model/input-file.ts";
import { FilePost } from "../model/post.ts";
import { logger } from "../core/logging.ts";

export abstract class PlatformClient {
  constructor(protected readonly pageUrl: URL) {}

  abstract name: string;

  public fetch = fetch;

  abstract fetchPost(): Promise<FilePost>;

  /**
   * We return a stream here so as to avoid downloading entire video at once.
   */
  getByteStream(url: string): Promise<ReadableStream<Uint8Array>> {
    return retry(async () => {
      const response = await this.fetch(url);
      if (!response.body) {
        throw Error("Failed to get video stream", { cause: response });
      }
      return response.body;
    });
  }

  /**
   * We return downloaded images in generator, because otherwise a single image download error
   * will cancel the entire post. Instead, we want to fill the missing image with a placeholder
   * and move on.
   */
  async *generateStreamBatches(
    files: MediaFile[],
  ): AsyncGenerator<MediaStream[], void, unknown> {
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const fileBatch = files.slice(i, i + BATCH_SIZE);

      yield Promise.all(
        fileBatch.map(async (file) => {
          try {
            const stream = await retry(async () => {
              const response = await this.fetch(file.downloadUrl);
              if (!response.body) {
                throw Error(`Failed to get ${file.type} stream`, {
                  cause: response,
                });
              }
              return response.body;
            });

            return {
              type: file.type,
              stream: stream,
            };
          } catch (e) {
            logger.error`Error fetching ${file.type} ${file.downloadUrl}\n${e}`;

            using errorImage = await Deno.open(Assets.img.error);
            return {
              type: file.type,
              stream: errorImage.readable,
            };
          }
        }),
      );
    }
  }

  static supportsLink(_url: URL): boolean {
    throw Error("Method must be overridden in the child class");
  }
}

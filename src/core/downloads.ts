import { join, resolve } from "@std/path";
import { tmpdir } from "node:os";
import { config } from "./config.ts";
import { log } from "./log.ts";

const root = resolve(config.DOWNLOAD_DIR || join(tmpdir(), "dinogram"));

/**
 * Every download gets its own job directory under the root. With
 * UPLOAD_BY_PATH, the Bot API server reads the files from there, and it runs
 * as another user. Thus the directories stay world-readable (0755), which
 * Deno.makeTempDir would not give (0700).
 */
export const Downloads = {
  root,

  cacheDir: join(root, ".yt-dlp-cache"),

  /**
   * No job survives a restart, so the job directories that exist at start
   * are leftovers of a crash or a kill.
   */
  async init() {
    await Deno.mkdir(root, { recursive: true, mode: 0o755 });

    for await (const entry of Deno.readDir(root)) {
      if (entry.isDirectory && entry.name.startsWith("job-")) {
        await Downloads.remove(join(root, entry.name));
      }
    }
  },

  async createJobDir(): Promise<string> {
    const dir = join(root, `job-${crypto.randomUUID()}`);
    await Deno.mkdir(dir, { recursive: true, mode: 0o755 });
    return dir;
  },

  async remove(dir: string) {
    try {
      await Deno.remove(dir, { recursive: true });
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) {
        log.error(`Failed to remove ${dir}`, e);
      }
    }
  },
};

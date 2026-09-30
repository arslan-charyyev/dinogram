import { assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
import { delay } from "@std/async";
import { RecentPosts } from "../src/bot/recent-posts.ts";
import { PlatformClient } from "../src/client/platform-client.ts";
import { FileBuilder } from "../src/model/file.ts";
import { FilePost, PostBuilder } from "../src/model/post.ts";

const postUrl = new URL("https://vt.tiktok.com/ZSbAcPqsY/");

class FakeClient extends PlatformClient {
  override name = "Fake";
  fetches = 0;

  constructor(private readonly fails = false) {
    super(postUrl);
  }

  override fetchPost(): Promise<FilePost> {
    this.fetches++;
    if (this.fails) return Promise.reject(Error("Fetch failed"));

    return Promise.resolve(PostBuilder.single({
      description: "",
      pageUrl: postUrl,
      file: FileBuilder.video({ downloadUrl: "https://example.com/v.mp4" }),
    }));
  }
}

Deno.test("Recent post keeps the client that fetched it", async () => {
  const posts = new RecentPosts(0);
  const queryClient = new FakeClient();
  const chosenClient = new FakeClient();

  const query = posts.fetch(postUrl, queryClient);
  const chosen = posts.fetch(postUrl, chosenClient);

  assertStrictEquals(chosen.client, queryClient, "query client comes back");
  assertStrictEquals(chosen.post, query.post, "same post comes back");
  assertEquals(chosenClient.fetches, 0, "chosen client fetches nothing");

  await chosen.post;
  // Lets the entry expire, so the test leaves no timer behind
  await delay(1);
});

Deno.test("Recent post expires after its lifetime", async () => {
  const posts = new RecentPosts(0);
  const first = new FakeClient();
  const second = new FakeClient();

  await posts.fetch(postUrl, first).post;
  await delay(1);

  assertStrictEquals(posts.fetch(postUrl, second).client, second);
  assertEquals(second.fetches, 1, "second client fetches the post again");

  await delay(1);
});

Deno.test("Failed recent post leaves at once", async () => {
  const posts = new RecentPosts(60_000);
  const failing = new FakeClient(true);
  const retry = new FakeClient(true);

  await assertRejects(() => posts.fetch(postUrl, failing).post);

  const again = posts.fetch(postUrl, retry);
  assertStrictEquals(again.client, retry, "next client fetches again");
  await assertRejects(() => again.post);
});

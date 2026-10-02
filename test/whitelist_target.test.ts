import { assertEquals } from "@std/assert";
import type { Chat, ChatFullInfo, User } from "@grammyjs/types";
import { joinLines } from "../src/utils/utils.ts";
import {
  chatTarget,
  formatTarget,
  userTarget,
} from "../src/bot/whitelist-target.ts";

const user: User = { id: 42, is_bot: false, first_name: "Aylar" };

Deno.test("User without a username links to the profile", () => {
  const target = userTarget(user);

  assertEquals(target.label, "Aylar", "label is the name");
  assertEquals(target.url, "tg://user?id=42", "link opens the profile");
});

Deno.test("User with a username links to the username", () => {
  const target = userTarget({ ...user, username: "aylar" });

  assertEquals(target.label, "Aylar (@aylar)", "label holds both");
  assertEquals(target.url, "https://t.me/aylar", "link names the username");
});

Deno.test("Public group links to its username", () => {
  const chat: Chat = {
    id: -1001,
    type: "supergroup",
    title: "Dinos",
    username: "dinos",
  };

  assertEquals(chatTarget(chat).url, "https://t.me/dinos");
});

Deno.test("Private group links to its invite link in a private chat", () => {
  const chat = {
    id: -1002,
    type: "supergroup",
    title: "Family",
  } as Chat;
  const full = {
    ...chat,
    invite_link: "https://t.me/+abc",
  } as ChatFullInfo;

  assertEquals(chatTarget(chat, true).url, undefined, "no link, no address");
  assertEquals(chatTarget(full, true).url, "https://t.me/+abc", "invite link");
  assertEquals(chatTarget(full).url, undefined, "group hides the invite link");
});

Deno.test("Target links its label and keeps the ID in plain text", () => {
  const text = formatTarget(userTarget(user));

  assertEquals(text.text, "42 — Aylar");
  assertEquals(text.entities, [
    { type: "text_link", offset: 5, length: 5, url: "tg://user?id=42" },
  ]);
});

Deno.test("Target that the bot cannot see gets a mark", () => {
  const text = formatTarget({ id: 7, label: "Old", reachable: false });

  assertEquals(text.text, "7 — Old ⚠️ not visible to the bot");
  assertEquals(text.entities, [], "no link without a lookup");
});

Deno.test("Joined lines move the links to their own line", () => {
  const text = joinLines(["Admins:", formatTarget(userTarget(user))]);

  assertEquals(text.text, "Admins:\n42 — Aylar");
  assertEquals(text.entities[0].offset, 13, "offset counts the first line");
});

import { assertEquals } from "@std/assert";
import { type CommandSpec, menuOf } from "../src/bot/command-registry.ts";

function spec(command: string, adminOnly: boolean): CommandSpec {
  return {
    command: command,
    description: `Run ${command}`,
    adminOnly: adminOnly,
    handler: () => {},
  };
}

const specs = [
  spec("subscribe", false),
  spec("allow", true),
  spec("subscriptions", false),
];

Deno.test("Menu for everyone leaves out the admin commands", () => {
  const menu = menuOf(specs, "everyone").map((it) => it.command);

  assertEquals(menu, ["subscribe", "subscriptions"], "admin command is absent");
});

Deno.test("Menu for admins holds every command in order", () => {
  const menu = menuOf(specs, "admins").map((it) => it.command);

  assertEquals(menu, ["subscribe", "allow", "subscriptions"], "all in order");
});

Deno.test("Menu entry carries the command and its description only", () => {
  assertEquals(menuOf([spec("allow", true)], "admins"), [
    { command: "allow", description: "Run allow" },
  ]);
});

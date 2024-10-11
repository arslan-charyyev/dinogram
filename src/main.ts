import { Dinogram } from "./bot/dinogram.ts";

if (import.meta.main) {
  const dinogram = new Dinogram();

  await dinogram.launch();
}

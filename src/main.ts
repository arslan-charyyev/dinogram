import { Dinogram } from "./bot/dinogram.ts";

if (import.meta.main) {
  // TODO: Print self version?

  const dinogram = new Dinogram();

  await dinogram.launch();
}

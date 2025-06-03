import { logger } from "../../core/logging.ts";
import { AuthMode } from "../../model/auth-mode.ts";
import { instagramDb } from "./instagram-db.ts";

export function getInstagramAuthMode() {
  return instagramDb.authMode.getOrDef();
}

export async function setInstagramAuthMode(authMode: AuthMode) {
  logger.info`Setting new Instagram auth mode: ${authMode}`;

  await instagramDb.authMode.set(authMode);
}

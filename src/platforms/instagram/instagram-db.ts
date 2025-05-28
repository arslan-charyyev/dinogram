import { createModel } from "../../core/db.ts";
import { AuthMode } from "../../model/auth-mode.ts";

export const instagramDb = {
  authMode: createModel<AuthMode>({
    keys: ["instagram", "authMode"],
    default: AuthMode.Anonymous,
  }),
};

import * as log from "@std/log";
import { config } from "./config.ts";

log.setup({
  handlers: {
    default: new log.ConsoleHandler(config.LOG_LEVEL, {
      formatter: ({ datetime, levelName, msg, args }) => {
        let line = `${datetime.toUTCString()} | ${levelName} | ${msg}`;

        if (args.length > 0) {
          const flatArgs = args.length === 1 ? args[0] : args;
          line += "\n" + JSON.stringify(flatArgs, undefined, 2);
        }

        return line;
      },
    }),
  },
  loggers: {
    default: {
      level: config.LOG_LEVEL,
      handlers: ["default"],
    },
  },
});

export { log };

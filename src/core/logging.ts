import { configure, getConsoleSink, getLogger } from "@logtape/logtape";

const APP_CATEGORY = "";

await configure({
  sinks: { console: getConsoleSink() },
  loggers: [
    { category: ["logtape", "meta"], sinks: [] },
    { category: [APP_CATEGORY], sinks: ["console"] },
  ],
});

export const logger = getLogger(APP_CATEGORY);

FROM denoland/deno:2.2.12

# TODO: Install xvfb, x11vnc, puppeteer:chrome

# Prefer not to run as root.

USER deno

WORKDIR /app

# Cache the dependencies as a layer

COPY deno.json deno.lock ./
RUN deno task deps:cache

# These steps will be re-run upon each file change in the working directory

COPY --chown=deno:deno . .

ENV DATA_DIR=/app/data/
RUN mkdir -p $DATA_DIR

CMD ["task", "main"]

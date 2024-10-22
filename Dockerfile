FROM denoland/deno:1.46.3

# Prefer not to run as root.
USER deno

WORKDIR /app

# Cache the dependencies as a layer
COPY deno.json deno.lock deps.ts ./
RUN deno cache deps.ts

# These steps will be re-run upon each file change in your working directory:
COPY --chown=deno:deno . .

# Cache app dependencies
RUN deno cache src

ENV DATA_DIR /app/data/
RUN mkdir -p $DATA_DIR

CMD ["task", "main"]

FROM denoland/deno:1.46.3

WORKDIR /app

# Prefer not to run as root.
USER deno

# Cache the dependencies as a layer
COPY deno.json deno.lock deps.ts ./
RUN deno cache deps.ts

# These steps will be re-run upon each file change in your working directory:
COPY --chown=deno:deno . .

# Cache app dependencies
RUN deno cache src

ENV DATA_DIR /app/data

CMD ["task", "main"]

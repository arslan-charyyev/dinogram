FROM denoland/deno:2.0.6

# Prefer not to run as root.
USER deno

WORKDIR /app

# Cache the dependencies as a layer
COPY deno.json deno.lock ./
RUN deno task cache-deps

# These steps will be re-run upon each file change in your working directory:
COPY --chown=deno:deno . .

ENV DATA_DIR /app/data/
RUN mkdir -p $DATA_DIR

CMD ["task", "main"]

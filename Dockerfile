# We choose puppeteer as a base image because
# it's the hardest one to install manually
FROM ghcr.io/puppeteer/puppeteer:24.9.0@sha256:e18b8931277418aee41e58e5750890b9da0990b19d434de54ed89818001c487b

ENV LANG=C.UTF-8

USER root

# Install dependencies for vnc streaming

RUN \
  --mount=target=/var/lib/apt/lists,type=cache,sharing=locked \
  --mount=target=/var/cache/apt,type=cache,sharing=locked \
  rm -f /etc/apt/apt.conf.d/docker-clean \
  && apt-get update \
  && apt-get -y --no-install-recommends install \
  xvfb x11vnc

# Prefer not to run as root.
# Username taken from: https://github.com/puppeteer/puppeteer/blob/main/docker/Dockerfile

ENV USER=pptruser
USER ${USER}

# Unfortunately, this download can't be cached 😕
RUN curl -fsSL https://deno.land/install.sh | sh -s v2.3.5 -y

ENV DENO_INSTALL="/home/${USER}/.deno"
ENV PATH="${DENO_INSTALL}/bin:${PATH}"

WORKDIR /app 

# Cache the dependencies as a layer
# Unfortunately, trying to cache this results in build error 😕
COPY deno.json deno.lock ./
RUN deno task deps:cache

# These steps will be re-run upon each file change in the working directory

COPY --chown=${USER}:${USER} . .

ENV DATA_DIR=/app/data/
RUN mkdir -p ${DATA_DIR}

# TODO: Delete this after piping RFB socket to internal socket
EXPOSE 5900-6000

# Replace node with deno as entrypoint
ENTRYPOINT ["deno"]

CMD ["task", "main"]

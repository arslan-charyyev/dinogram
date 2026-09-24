# A static ffmpeg merges the video and audio streams of YouTube. The apt
# package of the Deno image would mix in packages of another Debian release.
FROM mwader/static-ffmpeg:9.0.2 AS ffmpeg

FROM denoland/deno:2.4.3

# yt-dlp nightly, because YouTube breaks the stable release often. The
# bump-yt-dlp workflow updates the version and the checksum together. yt-dlp
# runs Deno from the PATH to solve the YouTube challenges.
ARG YT_DLP_VERSION=2026.09.16.232951
ARG YT_DLP_SHA256=69112248177f7c3a6ba7ed981e143a0214910ed6adeb40e075f08543f74a4850

COPY --from=ffmpeg /ffmpeg /ffprobe /usr/local/bin/
ADD --checksum=sha256:${YT_DLP_SHA256} --chmod=755 \
  https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/download/${YT_DLP_VERSION}/yt-dlp_linux \
  /usr/local/bin/yt-dlp

# Prefer not to run as root.

USER deno

WORKDIR /app

# Cache the dependencies as a layer

COPY deno.json deno.lock ./
RUN deno task deps:cache

# These steps will be re-run upon each file change in the working directory

COPY --chown=deno:deno . .

ENV DATA_DIR=/app/data/
# A new volume mounted here copies the owner of this directory, so the bot can
# write into it. The Bot API server reads from it with UPLOAD_BY_PATH.
ENV DOWNLOAD_DIR=/app/downloads/
RUN mkdir -p $DATA_DIR $DOWNLOAD_DIR

CMD ["task", "main"]

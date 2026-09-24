#!/usr/bin/env python3
"""Provision + deploy dinogram on a Coolify instance.

The release workflow builds the image and pushes it to GHCR; this script
reconciles the Coolify app that runs it. The whole Coolify config of the app
(image, resource limits, every env var) lives in SPEC and ENVS below: edit it
here, push a tag, and CI reconciles it. The first run creates the project and
the application, and every later run PATCHes them. The script uses only the
standard library, so the workflow needs no setup step.

Required environment:
  COOLIFY_URL   the base URL of the Coolify instance
  COOLIFY_TOKEN API token (Coolify UI -> Keys & Tokens) with the read, write
                and deploy abilities
  IMAGE_TAG     image tag to deploy, which is a released version such as 1.2.5
  BOT_TOKEN     Telegram bot token

Optional environment: BOT_ADMINS, WHITELIST, REPORT_ERRORS_TO. They hold
Telegram IDs, so they come from repository variables instead of this file: the
repository is public.

The GHCR package is public, so Coolify pulls it without credentials.
"""

import json
import os
import sys
import urllib.error
import urllib.request

PROJECT = "dinogram"
ENVIRONMENT = "production"
APP_NAME = "dinogram"

# The bot keeps its settings and its whitelist in a Deno KV database under this
# path, so the volume is what makes an /allow survive a redeploy. The Dockerfile
# sets the matching DATA_DIR.
DATA_MOUNT_PATH = "/app/data"
DATA_VOLUME_NAME = "dinogram-data"

# YouTube downloads land here, and the bot sends them to the Bot API server by
# their path (UPLOAD_BY_PATH), so that a 2 GB video never passes through the
# bot. The Bot API server runs outside Coolify, so its container must mount
# this same named volume at the same path, and run with TELEGRAM_LOCAL=1.
# Coolify names the Docker volume exactly as given here.
DOWNLOADS_MOUNT_PATH = "/app/downloads"
DOWNLOADS_VOLUME_NAME = "dinogram-downloads"

VOLUMES = {
    DATA_MOUNT_PATH: DATA_VOLUME_NAME,
    DOWNLOADS_MOUNT_PATH: DOWNLOADS_VOLUME_NAME,
}


def _required(name):
    """Read a value that the deployment cannot proceed without.

    An unset GitHub secret arrives as an empty string, not as a missing
    variable, so os.environ[name] would accept it and deploy a container that
    fails only at startup, minutes later and out of sight.
    """
    value = os.environ.get(name, "")
    if not value:
        sys.exit(f"{name} is empty — is the repository secret or variable set?")
    return value


# Reconciled on every run. Both POST /applications/dockerimage and
# PATCH /applications/{uuid} must accept every key here: their allow-lists
# differ, and PATCH rejects an unknown field with a 422.
SPEC = {
    "name": APP_NAME,
    "docker_registry_image_name": "ghcr.io/arslan-charyyev/dinogram",
    "docker_registry_image_tag": _required("IMAGE_TAG"),
    # The Telegram Bot API server runs beside Coolify, not inside it. This
    # joins the shared `coolify` network, where the name telegram-bot-api
    # resolves. Without it Coolify isolates the container and BOT_API_ROOT
    # points at nothing.
    "connect_to_docker_network": True,
    # Nothing listens here: the bot polls Telegram and makes only outbound
    # requests. The Coolify validator still wants a number, so this is a
    # placeholder. With no domain set, it never reaches a proxy label.
    "ports_exposes": "8080",
    # For the same reason, a health check could only fail.
    "health_check_enabled": False,
    # A YouTube probe can start a Deno process of about 350 MB beside yt-dlp,
    # which alone takes about 100 MB. Downloads go to disk, not to memory.
    "limits_memory": "1g",
    "limits_memory_reservation": "256m",
    "limits_cpus": "1",
}

# Create-only. The PATCH allow-list has neither key, so an update that sends
# them fails with a 422. Coolify defaults autogenerate_domain to true, which
# would mint a random sslip.io hostname and Traefik labels for a container that
# serves no HTTP. instant_deploy stays off, so the first container starts with
# its env already in place instead of crash-looping on an incomplete config.
CREATE_ONLY = {"autogenerate_domain": False, "instant_deploy": False}

# Env vars for the running container. The token comes from a GitHub secret, the
# Telegram IDs from GitHub variables, and the rest is inline. Empty values are
# dropped, so an unset optional value keeps the default of the bot.
_ENV_SPEC = {
    "BOT_TOKEN": _required("BOT_TOKEN"),
    # The local Bot API server that runs beside Coolify. It lifts the upload
    # limit from 50 MB to 2 GB.
    "BOT_API_ROOT": "http://telegram-bot-api:8081",
    "BOT_ADMINS": os.environ.get("BOT_ADMINS", ""),
    "WHITELIST": os.environ.get("WHITELIST", ""),
    "REPORT_ERRORS_TO": os.environ.get("REPORT_ERRORS_TO", ""),
    "LOG_LEVEL": "DEBUG",
    "SEND_AS_REPLY": "false",
    "SEND_ERRORS": "true",
    "SHOW_CAPTION_ABOVE_MEDIA": "false",
    # Needs the Bot API server in --local mode with the downloads volume; see
    # DOWNLOADS_VOLUME_NAME
    "UPLOAD_BY_PATH": "true",
    "WITH_CAPTION": "true",
}
ENVS = {k: v for k, v in _ENV_SPEC.items() if v}
# Every key that this script owns, even when it is dropped or empty now. The
# prune step deletes only keys in this set, so it never touches envs that
# Coolify or a user set.
MANAGED_KEYS = set(_ENV_SPEC)


def api(method, path, body=None, allow_404=False):
    req = urllib.request.Request(
        os.environ["COOLIFY_URL"].rstrip("/") + "/api/v1" + path,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            "Authorization": "Bearer " + os.environ["COOLIFY_TOKEN"],
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        if allow_404 and e.code == 404:
            return None
        sys.exit(f"{method} {path} -> HTTP {e.code}: {e.read().decode()}")


def main():
    server_uuid = api("GET", "/servers")[0]["uuid"]  # single-server instance

    project = next((p for p in api("GET", "/projects") if p["name"] == PROJECT), None)
    if project is None:
        project = api("POST", "/projects", {"name": PROJECT})
        print(f"created project {PROJECT} ({project['uuid']})")

    # Looked up in the environment of this project, not in the instance-wide
    # application list: Coolify does not enforce unique names across projects,
    # and this instance hosts unrelated apps.
    env = api("GET", f"/projects/{project['uuid']}/{ENVIRONMENT}", allow_404=True) or {}
    app = next((a for a in env.get("applications", []) if a["name"] == APP_NAME), None)

    if app is None:
        app = api(
            "POST",
            "/applications/dockerimage",
            {
                **SPEC,
                **CREATE_ONLY,
                "project_uuid": project["uuid"],
                "server_uuid": server_uuid,
                "environment_name": ENVIRONMENT,
            },
        )
        print(f"created application {APP_NAME} ({app['uuid']})")
    else:
        api("PATCH", f"/applications/{app['uuid']}", SPEC)
        print(f"updated application {APP_NAME} ({app['uuid']})")

    uuid = app["uuid"]

    # Created once and then left alone: Coolify keeps the volume across deploys,
    # and a PATCH of an existing mount path would only rename the volume.
    storages = api("GET", f"/applications/{uuid}/storages") or {}
    volumes = storages.get("persistent_storages", [])
    mount_paths = {volume.get("mount_path") for volume in volumes}
    for mount_path, volume_name in VOLUMES.items():
        if mount_path in mount_paths:
            continue
        api(
            "POST",
            f"/applications/{uuid}/storages",
            {
                "type": "persistent",
                "name": volume_name,
                "mount_path": mount_path,
            },
        )
        print(f"created volume {volume_name} at {mount_path}")

    # Prune managed keys that left the spec: envs/bulk only upserts, so a
    # removed value would otherwise stay in Coolify with its stale content.
    for env_var in api("GET", f"/applications/{uuid}/envs"):
        if env_var["key"] in MANAGED_KEYS and env_var["key"] not in ENVS:
            api("DELETE", f"/applications/{uuid}/envs/{env_var['uuid']}")
            print(f"deleted stale env {env_var['key']}")

    # is_literal stops Coolify from interpreting $ and escapes in the values, so
    # the token reaches the container byte-exact.
    api(
        "PATCH",
        f"/applications/{uuid}/envs/bulk",
        {
            "data": [{"key": k, "value": v, "is_literal": True} for k, v in ENVS.items()],
        },
    )
    print(f"synced {len(ENVS)} env vars")

    result = api("POST", f"/deploy?uuid={uuid}&force=true")
    print("deploy triggered:", json.dumps(result))


if __name__ == "__main__":
    main()

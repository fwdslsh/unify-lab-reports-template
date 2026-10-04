FROM oven/bun:1.4.1-slim@sha256:887d0f37f674c69984be4e397fef29ca0d74df1e75155431abbe857258bffde5
USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash ca-certificates git openssh-client python3 util-linux coreutils \
    && rm -rf /var/lib/apt/lists/*
ARG PUBLISH_UID=1000
ARG PUBLISH_GID=1000
RUN (getent group "$PUBLISH_GID" || groupadd --gid "$PUBLISH_GID" reports-site) \
    && (getent passwd "$PUBLISH_UID" || useradd --uid "$PUBLISH_UID" --gid "$PUBLISH_GID" --no-create-home --home-dir /state reports-site)
WORKDIR /app
COPY scripts/deploy.sh /app/deploy.sh
COPY scripts/settings.py /app/settings.py
COPY scripts/ /app/scripts/
COPY site.config.json lab.json /app/
COPY deploy/poll.sh /app/poll.sh
USER ${PUBLISH_UID}:${PUBLISH_GID}
ENV STATE_DIR=/state PUBLISH_DIR=/publish HOME=/state
HEALTHCHECK --interval=60s --timeout=5s --start-period=300s CMD bash -c 'read -r checked < /state/last-check-ok && [[ "$checked" =~ ^[0-9]+$ ]] && (( $(date +%s) - checked < 240 ))'
ENTRYPOINT ["bash", "/app/poll.sh"]

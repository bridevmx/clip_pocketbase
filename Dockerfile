# ─────────────────────────────────────────────────────────────────────────────
# Multi-arch Dockerfile for PocketBase + Payments Plugin
#
# Supports: linux/amd64, linux/arm64 (Oracle Cloud Ampere A1, AWS Graviton, etc.)
#
# PocketBase does NOT publish an official Docker image. This Dockerfile downloads
# the official binary from GitHub Releases, verifies its SHA-256 checksum, and
# runs the server as an unprivileged user.
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: Download and verify the correct PocketBase binary ───────────────
# Use the build host platform so we avoid QEMU emulation during download.
FROM --platform=$BUILDPLATFORM alpine:3.20 AS downloader

ARG PB_VERSION=0.39.10
ARG TARGETPLATFORM

RUN apk add --no-cache wget unzip ca-certificates && \
    if [ "$TARGETPLATFORM" = "linux/arm64" ]; then ARCH=arm64; \
    elif [ "$TARGETPLATFORM" = "linux/arm/v7" ]; then ARCH=armv7; \
    else ARCH=amd64; fi && \
    BASE_URL="https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}" && \
    cd /tmp && \
    wget -q "${BASE_URL}/pocketbase_${PB_VERSION}_linux_${ARCH}.zip" && \
    wget -q "${BASE_URL}/checksums.txt" && \
    grep "pocketbase_${PB_VERSION}_linux_${ARCH}.zip" checksums.txt | sha256sum -c - && \
    unzip "pocketbase_${PB_VERSION}_linux_${ARCH}.zip" -d /pb/ && \
    rm -f "pocketbase_${PB_VERSION}_linux_${ARCH}.zip" checksums.txt && \
    chmod +x /pb/pocketbase

# ── Stage 2: Minimal runtime image ───────────────────────────────────────────
FROM --platform=$TARGETPLATFORM alpine:3.20

RUN apk add --no-cache ca-certificates && \
    addgroup -S pocketbase && \
    adduser  -S -G pocketbase pocketbase && \
    mkdir -p /pb/pb_data && \
    chown -R pocketbase:pocketbase /pb

WORKDIR /pb

COPY --from=downloader --chown=pocketbase:pocketbase /pb/pocketbase    ./pocketbase
COPY --chown=pocketbase:pocketbase                    pb_hooks/         ./pb_hooks/
COPY --chown=pocketbase:pocketbase                    pb_migrations/    ./pb_migrations/
COPY --chown=pocketbase:pocketbase                    pb_public/        ./pb_public/

USER pocketbase

# Expose default PocketBase port
EXPOSE 8080

# Declare persistent data volume (SQLite DB + file storage)
VOLUME ["/pb/pb_data"]

# Health check — Coolify and container orchestrators will use this
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD wget -q --spider http://127.0.0.1:8080/api/health || exit 1

# Run PocketBase
CMD ["/pb/pocketbase", "serve", "--http=0.0.0.0:8080"]

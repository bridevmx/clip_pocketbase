# ─────────────────────────────────────────────────────────────────────────
# Stage 1: download the latest PocketBase binary
# ─────────────────────────────────────────────────────────────────────────
FROM alpine:3 AS downloader

ARG TARGETOS="linux"
ARG TARGETARCH="amd64"
ARG TARGETVARIANT=""

RUN apk add --no-cache curl unzip

RUN LATEST_VERSION=$(curl -s "https://api.github.com/repos/pocketbase/pocketbase/releases/latest" \
      -H "Accept: application/vnd.github+json" \
      | grep '"tag_name":' \
      | sed -E 's/.*"v([^"]+)".*/\1/') && \
    BUILDX_ARCH="${TARGETOS:-linux}_${TARGETARCH:-amd64}${TARGETVARIANT}" && \
    echo "Downloading PocketBase v${LATEST_VERSION} for ${BUILDX_ARCH}" && \
    curl -sL "https://github.com/pocketbase/pocketbase/releases/download/v${LATEST_VERSION}/pocketbase_${LATEST_VERSION}_${BUILDX_ARCH}.zip" \
      -o pocketbase.zip && \
    unzip pocketbase.zip && \
    chmod +x /pocketbase

# ─────────────────────────────────────────────────────────────────────────
# Stage 2: production image
# ─────────────────────────────────────────────────────────────────────────
FROM alpine:3

RUN apk add --no-cache ca-certificates su-exec

# Non-root user for security
RUN addgroup -S pbuser && adduser -S -G pbuser pbuser

# Copy PocketBase binary
COPY --from=downloader /pocketbase /usr/local/bin/pocketbase

# Copy plugin files into the image.
# pb_migrations/ runs automatically on first start and creates the
# clip_orders and clip_payments collections — no manual Admin UI steps needed.
# pb_hooks/ registers the Clip API routes and webhook handler.
COPY --chown=pbuser:pbuser pb_hooks/      /pb_data/pb_hooks/
COPY --chown=pbuser:pbuser pb_migrations/ /pb_data/pb_migrations/

# Persistent data volume (SQLite DB, uploads, etc.)
RUN mkdir -p /pb_data && chown -R pbuser:pbuser /pb_data
VOLUME ["/pb_data"]

EXPOSE 80

# ─────────────────────────────────────────────────────────────────────────
# Environment variables — DO NOT hardcode secrets here.
# Set the following in the Easypanel UI under App Service → Environment:
#
#   CLIP_API_KEY      Your Clip checkout API key (required)
#   POCKETBASE_URL    Public URL of this PocketBase instance, no trailing
#                     slash (required)  e.g. https://pb.myapp.com
#
# PocketBase reads them at runtime via $os.getenv("CLIP_API_KEY").
# ─────────────────────────────────────────────────────────────────────────

ENTRYPOINT ["su-exec", "pbuser", "/usr/local/bin/pocketbase", "serve", \
            "--http=0.0.0.0:80", "--dir=/pb_data"]

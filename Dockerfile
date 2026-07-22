FROM ghcr.io/pocketbase/pocketbase:v0.25.8

# Copy plugin files
COPY pb_hooks/ /pb/pb_hooks/
COPY pb_migrations/ /pb/pb_migrations/
COPY pb_public/ /pb/pb_public/

# Expose default PocketBase port
EXPOSE 8090

# Run PocketBase with migrations
CMD ["./pocketbase", "serve", "--http=0.0.0.0:8090"]

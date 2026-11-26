# Build context: apps/collab (it is its own Cargo workspace).

# Keep in step with rust-version in Cargo.toml. yrs 0.28 uses `if let` guards, stable since 1.95.
FROM rust:1.97-bookworm AS build
WORKDIR /src

# Build dependencies first so source edits reuse this layer.
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs && touch src/lib.rs \
    && cargo build --release --locked \
    && rm -rf src

COPY schema.sql ./
COPY src ./src
RUN touch src/main.rs src/lib.rs && cargo build --release --locked

# Fly mounts the volume at /data owned by root at run time, so a chown in the image
# does not reach it. The entrypoint chowns /data, then drops to the `collab` user.
FROM debian:bookworm-slim
RUN useradd --system --no-create-home --shell /usr/sbin/nologin collab \
    && mkdir /data && chown collab:collab /data
COPY --from=build /src/target/release/collab /usr/local/bin/collab
ENV COLLAB_ADDR=0.0.0.0:8787 \
    COLLAB_DB_PATH=/data/collab.db
EXPOSE 8787
ENTRYPOINT ["/bin/sh", "-c", "chown collab:collab /data && exec setpriv --reuid=collab --regid=collab --init-groups /usr/local/bin/collab"]

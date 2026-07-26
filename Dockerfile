# ---------- build ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app

# better-sqlite3 compiles from source when no prebuilt binary matches.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

# The published better-sqlite3 prebuilds for linux-arm64 are linked against a
# newer glibc (2.38) than bookworm ships (2.36) and fail to dlopen at runtime
# on arm64 hosts (Apple Silicon, Raspberry Pi). Force a from-source rebuild so
# the native binding actually loads regardless of build host architecture.
RUN rm -f node_modules/better-sqlite3/prebuilds/*.node \
    && npm rebuild better-sqlite3 --build-from-source

COPY . .
RUN npm run build

# ---------- runtime ----------
FROM node:22-bookworm-slim
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8687 \
    DATA_DIR=/app/data

# .output is self-contained: bundled server, static client, and the
# externalised better-sqlite3 with its native binding.
COPY --from=build /app/.output ./.output

RUN mkdir -p /app/data
EXPOSE 8687
CMD ["node", ".output/server/index.mjs"]

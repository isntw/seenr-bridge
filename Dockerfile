# ---------- build ----------
# Node 26 to match the development toolchain and satisfy nuxt@4.5's engine
# range (^22.19 || ^24.11 || >=26). trixie rather than bookworm because it is
# the modern Debian base paired with node:26 and ships glibc 2.41.
FROM node:26-trixie-slim AS build
WORKDIR /app

# better-sqlite3 13.0.1 publishes no prebuild for Node 26's ABI, so npm ci
# compiles the native binding from source and needs a toolchain to do it.
# Without these, `npm ci` fails with `gyp ERR! not ok`.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---------- runtime ----------
FROM node:26-trixie-slim
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8687 \
    DATA_DIR=/app/data

# .output is self-contained: bundled server, static client, and the
# externalised better-sqlite3 with the binding compiled in the build stage.
# Both stages share a base image so that binding is ABI- and glibc-compatible.
COPY --from=build /app/.output ./.output

RUN mkdir -p /app/data
EXPOSE 8687
CMD ["node", ".output/server/index.mjs"]

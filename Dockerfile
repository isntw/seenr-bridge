# ---------- build the React client ----------
FROM node:20-bookworm-slim AS client
WORKDIR /client
COPY client/package.json ./
RUN npm install
COPY client/ ./
RUN npm run build

# ---------- build the server ----------
FROM node:20-bookworm-slim AS server
WORKDIR /server
# build tools in case better-sqlite3 needs to compile (falls back to prebuilt otherwise)
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY server/package.json ./
RUN npm install
COPY server/ ./
RUN npm run build && npm prune --omit=dev

# ---------- runtime ----------
FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8687 \
    DATA_DIR=/app/data \
    PUBLIC_DIR=/app/public
COPY --from=server /server/node_modules ./node_modules
COPY --from=server /server/dist ./dist
COPY --from=client /client/dist ./public
RUN mkdir -p /app/data
EXPOSE 8687
CMD ["node", "dist/index.js"]

FROM node:22-bookworm-slim AS web
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY index.html ./
COPY scripts/build.mjs ./scripts/build.mjs
COPY src ./src
COPY shared ./shared
COPY public ./public
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates ffmpeg fontconfig fonts-dejavu-core fonts-noto-core python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=web /app/dist ./dist
COPY public ./public
COPY scripts ./scripts
COPY server ./server
COPY shared ./shared
RUN npm run setup && install -d -m 700 -o node -g node /data
ENV NODE_ENV=production HOST=0.0.0.0 PORT=5173 DATA_DIR=/data WHISPER_CACHE=/data/models
USER node
EXPOSE 5173
CMD ["node", "server/main.mjs"]

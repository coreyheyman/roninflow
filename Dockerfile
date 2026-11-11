# RoninFlow — self-hosted trading journal
#   docker compose up -d            (see docker-compose.yml)
#   docker run -d -p 5173:5173 -v tj-data:/data --name roninflow ghcr.io/coreyheyman/roninflow
# First start: open http://<server>:5173 and set a password with the setup code from `docker logs roninflow`.

FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm test && npm run build

FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=5173 \
    DATA_DIR=/data \
    TJ_LAN=1 \
    TJ_DOCKER=1
WORKDIR /app
# the server needs no npm packages at runtime — just Node, the built app and these files
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json /app/LICENSE /app/NOTICE.md ./
COPY --from=build /app/server.js /app/local-api.js /app/candles.js /app/connect.js /app/connect-apis.js /app/connect-markets.js /app/secrets.js /app/system.js /app/updater.js /app/ai-proxy.js /app/atas-sync.js /app/replica.js ./
COPY --from=build /app/src/lib/pairing.js ./src/lib/pairing.js
COPY --from=build /app/docs ./docs
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME /data
EXPOSE 5173
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:5173/healthz || exit 1
CMD ["node", "server.js"]

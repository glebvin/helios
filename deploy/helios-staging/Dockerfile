FROM node:24-alpine@sha256:a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/domain/package.json ./packages/domain/package.json
COPY apps/api/package.json ./apps/api/package.json
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY apps ./apps
COPY packages ./packages
COPY deploy ./deploy
RUN mkdir -p /var/lib/helios/evidence /var/run/helios && chown -R node:node /var/lib/helios /var/run/helios
USER node
ENV NODE_ENV=production
CMD ["node", "deploy/helios-staging/entry.mjs"]

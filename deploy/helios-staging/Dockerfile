FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/domain/package.json ./packages/domain/package.json
COPY apps/api/package.json ./apps/api/package.json
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY apps ./apps
COPY packages ./packages
COPY deploy ./deploy
RUN mkdir -p /var/lib/helios/evidence && chown -R node:node /var/lib/helios
USER node
ENV NODE_ENV=production
CMD ["node", "deploy/helios-staging/entry.mjs"]

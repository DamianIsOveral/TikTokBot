FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig*.json ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
COPY test ./test
RUN npm run typecheck && node scripts/check.ts && npm test && node scripts/cache-signing.ts && npm prune --omit=dev --ignore-scripts

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=127.0.0.1 PORT=3000
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY --from=build /app/public ./public
COPY --from=build /app/dist ./dist
COPY --from=build /app/scripts/healthcheck.ts ./scripts/healthcheck.ts
COPY --from=build --chown=node:node /app/.local-archive/signing-research ./.local-archive/signing-research
RUN mkdir /app/data && chown node:node /app/data
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD ["node", "scripts/healthcheck.ts"]
CMD ["node", "src/server/main.ts"]

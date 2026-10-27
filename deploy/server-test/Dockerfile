# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY --chown=node:node . .
# Optional CA mount supports managed build proxies without baking credentials/CA into layers.
RUN --mount=type=secret,id=proxy_ca \
    if [ -s /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci --strict-ssl=true
ENV VITE_API_BASE_URL=/v1
RUN npm run build && npm run build:admin

FROM build AS api
RUN mkdir -p /var/lib/album/objects && chown node:node /var/lib/album/objects
ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "deploy/server-test/api-entrypoint.mjs"]

FROM nginx:1.28-alpine AS web
COPY --from=build /app/apps/web/dist/ /usr/share/nginx/html/
COPY --from=build /app/apps/admin/dist/ /usr/share/nginx/html/admin/
COPY deploy/server-test/nginx.conf /etc/nginx/conf.d/default.conf
RUN find /usr/share/nginx/html -type d -exec chmod 755 {} \; && find /usr/share/nginx/html -type f -exec chmod 644 {} \;
EXPOSE 80

FROM postgres:17-alpine AS postgres
COPY docs/release-v1.0/database/001_initial.up.sql /docker-entrypoint-initdb.d/001-initial.sql
COPY apps/api/src/c3-runtime.sql /docker-entrypoint-initdb.d/002-runtime.sql
COPY docs/release-v1.0/database/002_order_snapshots.up.sql /docker-entrypoint-initdb.d/003-orders.sql
COPY docs/release-v1.0/database/003_redemption_batch_policy.up.sql /docker-entrypoint-initdb.d/004-redemption.sql
COPY docs/release-v1.0/database/004_financial_adjustments.up.sql /docker-entrypoint-initdb.d/005-adjustments.sql
COPY docs/release-v1.0/database/005_identity_payments.up.sql /docker-entrypoint-initdb.d/006-identity-payments.sql
COPY docs/release-v1.0/database/006_ai_runtime.up.sql /docker-entrypoint-initdb.d/007-ai-runtime.sql
RUN chmod 644 /docker-entrypoint-initdb.d/*.sql

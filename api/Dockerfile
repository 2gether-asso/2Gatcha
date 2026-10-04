# Image de l'API 2Gatcha, construite depuis la RACINE du depot (contexte ..)
# par GitHub Actions (.github/workflows/api-image.yml) : API + workflows + site.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    DB_PATH=/data/2gatcha.sqlite \
    WORKFLOWS_DIR=/app/workflows \
    SITE_DIR=/app/site
COPY api/package.json api/package-lock.json ./api/
# Seule dependance : @sentry/node (suivi des erreurs, inactif sans SENTRY_DSN).
RUN cd api && npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY api/src ./api/src
COPY api/scripts ./api/scripts
COPY n8n/workflows ./workflows
COPY site ./site
WORKDIR /app/api
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/health >/dev/null || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]

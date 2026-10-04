# Image de l'API 2Gatcha. Construite depuis la RACINE du depot (voir
# docker-compose.yml) pour embarquer les workflows et, en option, le site.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    DB_PATH=/data/2gatcha.sqlite \
    WORKFLOWS_DIR=/app/workflows \
    SITE_DIR=/app/site
COPY api/package.json ./api/
COPY api/src ./api/src
COPY api/scripts ./api/scripts
COPY n8n/workflows ./workflows
COPY site ./site
WORKDIR /app/api
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/health >/dev/null || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]

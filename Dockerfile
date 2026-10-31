FROM node:24.15.0-bookworm-slim
WORKDIR /app
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
COPY --chown=node:node package.json ./
RUN mkdir -p /app/data && chown node:node /app/data
USER node
ENV HOST=0.0.0.0 PORT=4317 DB_PATH=/app/data/orderflow.sqlite
EXPOSE 4317
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD node -e "fetch('http://127.0.0.1:4317/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/main.ts"]

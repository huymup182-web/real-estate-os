# Image production của backend (TASK-160, docs/deployment.md). Build từ thư mục gốc repo:
#   docker build -f backend/Dockerfile -t real-estate-os-backend .
# Cùng image chạy API (mặc định) và lệnh sao lưu (`node dist/backup/backup.cli.js create`).

FROM node:22-alpine AS build
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY tsconfig.base.json /app/
COPY backend/ ./
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
# pg_dump/pg_restore 16 cho sao lưu (docs/backup.md); tini chuyển SIGTERM cho Node và dọn tiến trình con.
RUN apk add --no-cache postgresql16-client tini \
  && mkdir -p /backups && chown node:node /backups
ENV NODE_ENV=production \
  PORT=3000 \
  BACKUP_DIR=/backups
WORKDIR /app/backend
COPY --from=build /app/backend/package.json ./
COPY --from=build /app/backend/node_modules ./node_modules
COPY --from=build /app/backend/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO /dev/null http://127.0.0.1:3000/api/v1/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]

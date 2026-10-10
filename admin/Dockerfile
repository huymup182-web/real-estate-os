# Image production của web quản trị (TASK-160, docs/deployment.md). Build từ thư mục gốc repo:
#   docker build -f admin/Dockerfile -t real-estate-os-admin .

FROM node:22-alpine AS build
WORKDIR /app/admin
COPY admin/package.json admin/package-lock.json ./
RUN npm ci
COPY tsconfig.base.json /app/
COPY admin/ ./
ENV NEXT_TELEMETRY_DISABLED=1 \
  NEXT_OUTPUT=standalone
RUN npm run build

FROM node:22-alpine
RUN apk add --no-cache tini
ENV NODE_ENV=production \
  NEXT_TELEMETRY_DISABLED=1 \
  PORT=3001 \
  HOSTNAME=0.0.0.0
# Gốc build là thư mục repo (next.config.ts) nên bản standalone nằm ở .next/standalone/admin/.
WORKDIR /app
COPY --from=build /app/admin/.next/standalone ./
COPY --from=build /app/admin/.next/static ./admin/.next/static
WORKDIR /app/admin
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO /dev/null http://127.0.0.1:3001/login || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]

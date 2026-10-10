# Image chạy migration database ở production (TASK-160, docs/deployment.md). Build từ thư mục gốc repo:
#   docker build -f database/Dockerfile -t real-estate-os-migrate .
# Mặc định chạy `run` (áp migration chưa chạy); `show` xem trạng thái. Không có `seed` dữ liệu demo ở production.

FROM node:22-alpine
WORKDIR /app/database
COPY database/package.json database/package-lock.json ./
RUN npm ci --omit=dev
COPY database/src ./src
COPY database/migrations ./migrations
USER node
ENTRYPOINT ["node", "src/cli.ts"]
CMD ["run"]

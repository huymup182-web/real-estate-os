// Server giữ chỗ cho container dev khi ứng dụng chưa được khởi tạo.
// Chỉ dùng module có sẵn của Node.js, không cần dependency.
const http = require('node:http');

const port = Number(process.env.PORT) || 3000;
const service = process.env.SERVICE_NAME || 'app';

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(
    JSON.stringify({
      service,
      status: 'placeholder',
      message: `${service} chưa được khởi tạo`,
    }),
  );
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[${service}] placeholder đang chạy trên cổng ${port}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));

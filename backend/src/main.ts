import 'reflect-metadata';

import { Logger } from '@nestjs/common';

import { createApp } from './app.factory.js';
import { loadAppConfig } from './config/app-config.js';

async function bootstrap(): Promise<void> {
  const config = loadAppConfig();
  const app = await createApp();
  await app.listen(config.port, '0.0.0.0');
  new Logger('Bootstrap').log(`Backend chạy ở cổng ${config.port} (${config.nodeEnv})`);
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

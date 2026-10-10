import 'reflect-metadata';

import { Logger } from '@nestjs/common';

import { createApp } from './app.factory.js';
import type { AppConfig } from './config/app-config.js';
import { APP_CONFIG } from './config/app-config.module.js';
import { logProcessCrashes } from './monitoring/crash-logging.js';

async function bootstrap(): Promise<void> {
  // Logger tĩnh của NestJS dùng AppLogger (JSON) sau khi createApp chạy.
  logProcessCrashes(new Logger('Process'));
  const app = await createApp();
  const config = app.get<AppConfig>(APP_CONFIG);
  await app.listen(config.port, '0.0.0.0');
  new Logger('Bootstrap').log(`Backend chạy ở cổng ${config.port} (${config.nodeEnv})`);
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

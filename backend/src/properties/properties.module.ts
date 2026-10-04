import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PropertiesController } from './properties.controller.js';
import { PropertiesService } from './properties.service.js';
import { Property } from './property.entity.js';

/** Module BĐS (Phase 4). */
@Module({
  imports: [TypeOrmModule.forFeature([Property])],
  controllers: [PropertiesController],
  providers: [PropertiesService],
})
export class PropertiesModule {}

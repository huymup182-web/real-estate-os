import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { StorageModule } from '../storage/storage.module.js';
import { PropertiesController } from './properties.controller.js';
import { PropertiesService } from './properties.service.js';
import { Property } from './property.entity.js';
import { PropertyImagesController } from './property-images.controller.js';
import { PropertyImagesService } from './property-images.service.js';

/** Module BĐS (Phase 4). */
@Module({
  imports: [TypeOrmModule.forFeature([Property]), StorageModule],
  controllers: [PropertiesController, PropertyImagesController],
  providers: [PropertiesService, PropertyImagesService],
})
export class PropertiesModule {}

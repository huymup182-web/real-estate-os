import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { PropertyDuplicatesController } from './property-duplicates.controller.js';
import { PropertyDuplicatesService } from './property-duplicates.service.js';
import { PropertiesController } from './properties.controller.js';
import { PropertiesService } from './properties.service.js';
import { Property } from './property.entity.js';
import { PropertyDocumentsController } from './property-documents.controller.js';
import { PropertyDocumentsService } from './property-documents.service.js';
import { PropertyEvents } from './property-events.js';
import { PropertyImagesController } from './property-images.controller.js';
import { PropertyImagesService } from './property-images.service.js';
import {
  PropertyShareLinksController,
  SharedPropertiesController,
} from './property-share-links.controller.js';
import { PropertyShareLinksService } from './property-share-links.service.js';
import { PropertyVerificationJob } from './property-verification.job.js';

/** Module BĐS (Phase 4). */
@Module({
  imports: [TypeOrmModule.forFeature([Property]), StorageModule, AuditModule],
  controllers: [
    PropertiesController,
    PropertyDuplicatesController,
    PropertyImagesController,
    PropertyDocumentsController,
    PropertyShareLinksController,
    SharedPropertiesController,
  ],
  providers: [
    PropertiesService,
    PropertyEvents,
    PropertyDuplicatesService,
    PropertyImagesService,
    PropertyDocumentsService,
    PropertyShareLinksService,
    PropertyVerificationJob,
  ],
  exports: [PropertiesService, PropertyEvents],
})
export class PropertiesModule {}

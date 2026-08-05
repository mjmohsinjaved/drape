import { Module } from '@nestjs/common';

import { FilesController } from './controllers/files.controller';
import { FileDownloadService } from './services/file-download.service';
import { FileUploadService } from './services/file-upload.service';
import { UploadTicketService } from './services/upload-ticket.service';

/**
 * ARCHITECTURE §5.20 / §3.5 — the upload and download surface for the whole application.
 *
 * This module is the single choke point for bytes. Every other module deals in keys and signed
 * URLs; none of them read a file, write a file or serve one. That is what makes the storage
 * guarantees checkable: there is one place to look for "how does a byte get in", one place for
 * "how does a byte get out", and `STORAGE_ROOT` is reachable from nowhere else.
 *
 * Nothing is exported. `StorageService` is already `@Global()`, so a module that needs a signed
 * URL asks storage for one rather than asking this module for anything.
 *
 * `StorageModule`, `ConfigModule` and `EventEmitterModule` are all global in the composition
 * root, so none of them are imported here.
 */
@Module({
  controllers: [FilesController],
  providers: [FileDownloadService, UploadTicketService, FileUploadService],
})
export class FilesModule {}

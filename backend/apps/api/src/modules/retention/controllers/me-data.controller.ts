import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiAcceptedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  ApiStandardResponses,
  CurrentUser,
  ResponseMessage,
  Role,
  Roles,
  type ICurrentUser,
} from '@library/common';

import {
  DataExportResponseDto,
  DeletionReceiptResponseDto,
  ExportIdParamDto,
} from '../dto/data-export-response.dto';
import { MyDataResponseDto } from '../dto/my-data-response.dto';
import { AccountDeletionService } from '../services/account-deletion.service';
import { DataExportService } from '../services/data-export.service';
import { MyDataService } from '../services/my-data.service';

/**
 * Her own data controls — PRD C-37 … C-40, ARCHITECTURE §5.2.
 *
 * > C-40: "These controls are reachable from the account menu on every screen."
 *
 * **Every handler is `@Roles(Role.CONSUMER)`**, which is what §5.2 declares for all
 * four. An admin has no business on any of them: `GET /me/data` returns her original
 * photographs, and S-10 does not bend for a route that happens to be called `/me`.
 * `DELETE /me` is consumer-only for a second reason — an admin deleting their own
 * account through here would bypass the last-active-admin protection `users` enforces
 * on the admin path.
 *
 * ### Why these live in `retention` rather than in `users`
 *
 * §5.2 lists them under `users` because that is where the `/me` prefix lives, and
 * `MeController` there owns the profile half. These four are the **retention** half:
 * they read the deletion log, run the C-39 archive writer and queue the A-20 purge, all
 * of which are this module's (§4.33 gives it `deletion_log`). Two controllers on one
 * path prefix with no overlapping routes — and the alternative, `users` importing this
 * module's three services, would put a ZIP writer in the injector of the module that
 * serves `GET /me`.
 */
@ApiTags('My data')
@Controller('me')
export class MeDataController {
  constructor(
    private readonly myData: MyDataService,
    private readonly exports: DataExportService,
    private readonly deletions: AccountDeletionService,
  ) {}

  @Get('data')
  @Roles(Role.CONSUMER)
  @ResponseMessage('Your data retrieved successfully')
  @ApiOperation({
    summary:
      'Everything stored about her: profile, photos, renders, shortlists, enquiries, consent (C-37)',
    description:
      'A live read, never a cached snapshot — a stored copy of "everything about her" would ' +
      'be a second place her data lives. Each list is capped at one screen and reports its ' +
      'true total beside the count shown; `POST /me/export` is where she gets all of it. ' +
      'Photo and render URLs are signed and scoped to her own id (§3.4).',
  })
  @ApiOkResponse({ type: MyDataResponseDto })
  @ApiStandardResponses()
  data(@CurrentUser() user: ICurrentUser): Promise<MyDataResponseDto> {
    return this.myData.myData(user);
  }

  @Post('export')
  @Roles(Role.CONSUMER)
  @ResponseMessage('Export ready')
  @ApiOperation({
    summary: 'Start a data export archive (C-39)',
    description:
      'Builds a real ZIP — local file headers, central directory, EOCD, CRC-32 per entry — ' +
      'containing `manifest.json`, `shortlist.json` and her renders. It is built inline ' +
      'rather than queued, because C-5 caps her at fifteen generations a month and the ' +
      'archive takes less time than a page load. Capped, and a `TRUNCATED.txt` goes inside ' +
      'the file when a cap bites, so the fact travels with the archive.',
  })
  @ApiOkResponse({ type: DataExportResponseDto })
  @ApiStandardResponses()
  createExport(@CurrentUser() user: ICurrentUser): Promise<DataExportResponseDto> {
    return this.exports.createExport(user);
  }

  @Get('export/:exportId')
  @Roles(Role.CONSUMER)
  @ResponseMessage('Export retrieved successfully')
  @ApiOperation({
    summary: 'Export status, and the signed download URL when ready (§5.2)',
    description:
      'The key is rebuilt from **her session** and the validated uuid, so an id belonging ' +
      'to another account addresses an object inside her own prefix that does not exist — a ' +
      '404, indistinguishable from an id that never existed (S-9). There is no ownership ' +
      'check because there is no way to express a cross-account read.',
  })
  @ApiOkResponse({ type: DataExportResponseDto })
  @ApiStandardResponses({ notFound: true })
  findExport(
    @CurrentUser() user: ICurrentUser,
    @Param() params: ExportIdParamDto,
  ): Promise<DataExportResponseDto> {
    return this.exports.findExport(user, params.exportId);
  }

  @Delete()
  @Roles(Role.CONSUMER)
  @HttpCode(HttpStatus.ACCEPTED)
  @ResponseMessage('Account deletion requested')
  @ApiOperation({
    summary: 'Delete her account and all data. Immediate from her view, backend within 24 h (C-38)',
    description:
      '202 with the `deletion_log` receipt. Her sessions are revoked and the account is ' +
      'deactivated before this answers, so nothing more can be created against it; the ' +
      'cascade — rows, storage prefixes, cache pointers — runs on the retention sweep ' +
      'inside `DELETION_SLA_HOURS`. `completedAt` on the receipt is null until it has ' +
      'actually run, because reporting a completion that has not happened is the one lie ' +
      'this module exists to avoid.',
  })
  @ApiAcceptedResponse({ type: DeletionReceiptResponseDto })
  @ApiStandardResponses({ conflict: true })
  requestDeletion(@CurrentUser() user: ICurrentUser): Promise<DeletionReceiptResponseDto> {
    return this.deletions.requestSelfDeletion(user);
  }
}

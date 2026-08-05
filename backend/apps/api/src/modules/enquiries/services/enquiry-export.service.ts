import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import { In, Repository } from 'typeorm';

import { type ICurrentUser } from '@library/common';

import { AUDIT_RECORD_EVENT, AuditRecordEvent } from '@api/modules/audit/events/audit.event';
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from '@api/shared/constants/audit-actions.constant';

import { ENQUIRY_EXPORT_PAGE_SIZE } from '../constants/enquiry.constants';
import { EnquiryItem } from '../entities/enquiry-item.entity';
import { Enquiry } from '../entities/enquiry.entity';
import { isStaleEnquiry } from '../mappers/enquiry.mapper';

import { AdminEnquiriesService } from './admin-enquiries.service';

import type { AdminEnquiryQueryDto } from '../dto/enquiry-query.dto';

/**
 * The slice of a writable stream this service needs.
 *
 * Declared structurally rather than as `Response`, so the export can be pointed at a
 * file or at a buffer in a test without either pretending to be Express.
 */
export interface CsvSink {
  /** Returns false when the buffer is full and the caller should wait for `drain`. */
  write(chunk: string): boolean;
  once(event: 'drain', listener: () => void): unknown;
  end(): unknown;
}

/** The header row, and the order every data row follows. */
const CSV_COLUMNS = [
  'reference',
  'status',
  'submittedAt',
  'consumerName',
  'consumerEmail',
  'consumerPhone',
  'eventType',
  'eventDate',
  'budgetBand',
  'items',
  'totalValue',
  'assignedTo',
  'firstRespondedAt',
  'closedAt',
  'stale',
  'lostReason',
] as const;

/**
 * **CSV export — PRD A-26, ARCHITECTURE §5.15.**
 *
 * ### It streams, because the alternative does not degrade — it falls over
 *
 * A studio's second year of enquiries is not a large table, but "not large yet" is not
 * a design. This reads a fixed page, writes it, and **waits for the socket to drain**
 * before reading the next, so peak memory is one page regardless of how much is being
 * exported and a slow client cannot make the API buffer on its behalf. Building one
 * string and returning it would put the whole result set — including every contact
 * detail in it — in the heap at once.
 *
 * The filter comes from the same `buildWhere` the inbox uses, so "export what I am
 * looking at" exports exactly what the admin is looking at.
 *
 * ### Two things a CSV needs that JSON does not
 *
 * - **Quoting.** A comma, a quote or a newline inside a field would otherwise shift
 *   every column after it. Fields are quoted and inner quotes doubled, per RFC 4180.
 * - **Formula neutering.** A value starting `=`, `+`, `-` or `@` is executed as a
 *   formula when the file is opened in Excel or Sheets. A consumer's message is
 *   attacker-controlled text, so those values are prefixed with `'` — the receiving
 *   spreadsheet shows the text and runs nothing.
 *
 * Every export writes an `ENQUIRY_EXPORTED` audit row (A-3): this is the one route that
 * takes verified contact details out of the system in bulk, and who did that, and when,
 * is worth knowing.
 */
@Injectable()
export class EnquiryExportService {
  constructor(
    @InjectRepository(Enquiry)
    private readonly enquiries: Repository<Enquiry>,
    @InjectRepository(EnquiryItem)
    private readonly items: Repository<EnquiryItem>,
    private readonly admin: AdminEnquiriesService,
    private readonly events: EventEmitter2,
  ) {}

  /** A filename that sorts and reads well in a downloads folder. */
  filenameFor(now: Date = new Date()): string {
    return `drape-enquiries-${now.toISOString().slice(0, 10)}.csv`;
  }

  /**
   * Streams the filtered set into `sink` and resolves with the row count.
   *
   * The sink is **not** ended here: the caller owns the response and knows whether it
   * has trailers to write.
   */
  async streamCsv(
    actor: ICurrentUser,
    query: AdminEnquiryQueryDto,
    sink: CsvSink,
  ): Promise<number> {
    const now = new Date();
    const where = this.admin.buildWhere(query, now);

    await this.writeLine(sink, CSV_COLUMNS.join(','));

    let exported = 0;
    let skip = 0;

    for (;;) {
      const page = await this.enquiries.find({
        where,
        // A total order, so paging by offset cannot show a row twice or skip one.
        order: { createdAt: 'ASC', id: 'ASC' },
        skip,
        take: ENQUIRY_EXPORT_PAGE_SIZE,
      });

      if (page.length === 0) {
        break;
      }

      const counts = await this.itemCounts(page.map((row) => row.id));

      for (const enquiry of page) {
        await this.writeLine(sink, this.toRow(enquiry, counts.get(enquiry.id) ?? 0, now));
        exported += 1;
      }

      skip += page.length;
      if (page.length < ENQUIRY_EXPORT_PAGE_SIZE) {
        break;
      }
    }

    this.events.emit(
      AUDIT_RECORD_EVENT,
      new AuditRecordEvent({
        action: AUDIT_ACTIONS.ENQUIRY_EXPORTED,
        targetType: AUDIT_TARGET_TYPES.ENQUIRY,
        actorId: actor.id,
        actorRole: actor.role,
        // Counts and filters, never the exported rows themselves (E-12).
        metadata: { exported, status: query.status ?? null, stale: query.stale ?? false },
      }),
    );

    return exported;
  }

  /* -----------------------------------------------------------------------------------------
   * Internals
   * -------------------------------------------------------------------------------------- */

  /** Writes one line, respecting backpressure. This is what keeps memory flat. */
  private async writeLine(sink: CsvSink, line: string): Promise<void> {
    if (!sink.write(`${line}\n`)) {
      await new Promise<void>((resolve) => sink.once('drain', resolve));
    }
  }

  private toRow(enquiry: Enquiry, itemCount: number, now: Date): string {
    const values: readonly (string | number | null)[] = [
      enquiry.reference,
      enquiry.status,
      enquiry.createdAt.toISOString(),
      enquiry.contactName,
      enquiry.contactEmail,
      enquiry.contactPhone,
      enquiry.eventType,
      enquiry.eventDate === null ? null : this.toDateOnly(enquiry.eventDate),
      enquiry.budgetBand,
      itemCount,
      enquiry.totalValueSnapshot,
      enquiry.assignedTo,
      enquiry.firstRespondedAt === null ? null : enquiry.firstRespondedAt.toISOString(),
      enquiry.closedAt === null ? null : enquiry.closedAt.toISOString(),
      isStaleEnquiry(enquiry, now) ? 'yes' : 'no',
      enquiry.lostReason,
    ];

    return values.map((value) => this.escape(value)).join(',');
  }

  /** `date` columns come back as a `Date` at UTC midnight; only the calendar day matters. */
  private toDateOnly(value: Date): string {
    return value.toISOString().slice(0, 10);
  }

  /** RFC 4180 quoting, plus formula neutering for the spreadsheet that opens this. */
  private escape(value: string | number | null): string {
    if (value === null) {
      return '';
    }

    const raw = typeof value === 'number' ? `${value}` : value;
    const neutered = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;

    return `"${neutered.replace(/"/g, '""')}"`;
  }

  /** Item counts for a page, in one query rather than one per row. */
  private async itemCounts(enquiryIds: readonly string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (enquiryIds.length === 0) {
      return counts;
    }

    const rows = await this.items.find({ where: { enquiryId: In([...enquiryIds]) } });
    for (const row of rows) {
      counts.set(row.enquiryId, (counts.get(row.enquiryId) ?? 0) + 1);
    }
    return counts;
  }
}

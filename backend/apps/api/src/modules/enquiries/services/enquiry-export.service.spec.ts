import { EventEmitter2 } from '@nestjs/event-emitter';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Role } from '@library/common';
import type { ICurrentUser } from '@library/common';

import { AUDIT_RECORD_EVENT, type AuditRecordEvent } from '@api/modules/audit/events/audit.event';
import { sessionFor } from '@api/modules/users/testing/route-authorisation';
import { AUDIT_ACTIONS } from '@api/shared/constants/audit-actions.constant';

import { buildEnquiry } from '../../../../test/factories';
import {
  createInMemoryRepository,
  createMock,
  createTestingModule,
} from '../../../../test/fixtures';
import { freezeClock, restoreClock } from '../../../../test/setup/time';
import { ENQUIRY_EXPORT_PAGE_SIZE } from '../constants/enquiry.constants';
import { EnquiryItem } from '../entities/enquiry-item.entity';
import { Enquiry } from '../entities/enquiry.entity';
import { EnquiryStatus } from '../enums/enquiry-status.enum';
import { buildEnquiryItem } from '../testing/enquiry-fixtures';

import { AdminEnquiriesService } from './admin-enquiries.service';
import { EnquiryExportService } from './enquiry-export.service';

import type { CsvSink } from './enquiry-export.service';

/**
 * **A-26 — the CSV export.**
 *
 * Two properties are worth a test rather than a read-through: that it **streams** —
 * writes are interleaved with reads and backpressure is honoured, so peak memory is one
 * page rather than the whole result set — and that a consumer's own text cannot break
 * out of a cell or execute in the spreadsheet that opens it.
 */
describe('EnquiryExportService', () => {
  const admin: ICurrentUser = sessionFor(Role.ADMIN);

  /** A sink that records what it was given, and can refuse a write to force a drain. */
  interface RecordingSink extends CsvSink {
    readonly chunks: string[];
    readonly drains: number;
    /** Writes accepted before the sink starts asking for a drain. */
    acceptBefore: number;
  }

  function createSink(acceptBefore = Number.POSITIVE_INFINITY): RecordingSink {
    const chunks: string[] = [];
    let drains = 0;

    const sink: RecordingSink = {
      chunks,
      get drains(): number {
        return drains;
      },
      acceptBefore,
      write(chunk: string): boolean {
        chunks.push(chunk);
        return chunks.length < sink.acceptBefore;
      },
      once(_event: 'drain', listener: () => void): unknown {
        drains += 1;
        // The socket flushes asynchronously, exactly as a real one would. A promise
        // rather than `setImmediate` because this suite freezes the clock, and a faked
        // timer would never fire.
        void Promise.resolve().then(listener);
        return sink;
      },
      end(): unknown {
        return sink;
      },
    };

    return sink;
  }

  async function arrange(
    options: { enquiries?: readonly Enquiry[]; items?: readonly EnquiryItem[] } = {},
  ): Promise<{
    service: EnquiryExportService;
    events: jest.Mocked<EventEmitter2>;
    close: () => Promise<void>;
  }> {
    const enquiries = createInMemoryRepository<Enquiry>({ rows: options.enquiries ?? [] });
    const items = createInMemoryRepository<EnquiryItem>({ rows: options.items ?? [] });
    const events = createMock<EventEmitter2>(['emit']);

    const admins = createMock<AdminEnquiriesService>(['buildWhere']);
    admins.buildWhere.mockReturnValue([{}]);

    const harness = await createTestingModule({
      providers: [EnquiryExportService],
      overrides: [
        { token: getRepositoryToken(Enquiry), value: enquiries },
        { token: getRepositoryToken(EnquiryItem), value: items },
        { token: AdminEnquiriesService, value: admins },
        { token: EventEmitter2, value: events },
      ],
    });

    return {
      service: harness.get<EnquiryExportService>(EnquiryExportService),
      events,
      close: harness.close,
    };
  }

  const query = { page: 1, limit: 20, sortBy: 'createdAt', sortOrder: 'DESC' as const };

  beforeEach(() => freezeClock());
  afterEach(() => restoreClock());

  /* --------------------------------------------------------------------------------------- */

  it('writes a header row and one row per enquiry', async () => {
    const rows = [buildEnquiry(), buildEnquiry(), buildEnquiry()];
    const harness = await arrange({ enquiries: rows });
    const sink = createSink();

    const exported = await harness.service.streamCsv(admin, query, sink);

    expect(exported).toBe(3);
    expect(sink.chunks).toHaveLength(4);
    expect(sink.chunks[0]).toContain('reference,status,submittedAt');

    await harness.close();
  });

  it('carries the item count for each enquiry', async () => {
    const enquiry = buildEnquiry();
    const harness = await arrange({
      enquiries: [enquiry],
      items: [
        buildEnquiryItem({ enquiryId: enquiry.id, rank: 1 }),
        buildEnquiryItem({ enquiryId: enquiry.id, rank: 2 }),
      ],
    });
    const sink = createSink();

    await harness.service.streamCsv(admin, query, sink);

    expect(sink.chunks[1]).toContain('"2"');

    await harness.close();
  });

  describe('it streams rather than buffering', () => {
    it('waits for the socket to drain before reading on', async () => {
      const harness = await arrange({ enquiries: [buildEnquiry(), buildEnquiry()] });
      // Refuse after the header, so every row write has to wait.
      const sink = createSink(1);

      await harness.service.streamCsv(admin, query, sink);

      expect(sink.drains).toBeGreaterThan(0);

      await harness.close();
    });

    it('pages rather than loading the whole set at once', async () => {
      // One row more than a page, so a second read is required.
      const rows = Array.from({ length: ENQUIRY_EXPORT_PAGE_SIZE + 1 }, () => buildEnquiry());
      const harness = await arrange({ enquiries: rows });
      const sink = createSink();

      const exported = await harness.service.streamCsv(admin, query, sink);

      expect(exported).toBe(ENQUIRY_EXPORT_PAGE_SIZE + 1);
      expect(sink.chunks).toHaveLength(ENQUIRY_EXPORT_PAGE_SIZE + 2);

      await harness.close();
    });

    it('handles an empty result set without writing a row', async () => {
      const harness = await arrange({ enquiries: [] });
      const sink = createSink();

      expect(await harness.service.streamCsv(admin, query, sink)).toBe(0);
      expect(sink.chunks).toHaveLength(1);

      await harness.close();
    });
  });

  describe('a cell cannot break out of its column, or run', () => {
    it('quotes a value containing a comma, a quote or a newline', async () => {
      const enquiry = buildEnquiry({
        contactName: 'Mahmood, Sana "Sana" \nof Lahore',
        status: EnquiryStatus.NEW,
      });
      const harness = await arrange({ enquiries: [enquiry] });
      const sink = createSink();

      await harness.service.streamCsv(admin, query, sink);

      // Quoted, with inner quotes doubled, per RFC 4180.
      expect(sink.chunks[1]).toContain('"Mahmood, Sana ""Sana"" \nof Lahore"');

      await harness.close();
    });

    it('neuters a value a spreadsheet would run as a formula', async () => {
      const enquiry = buildEnquiry({ contactName: '=HYPERLINK("http://evil.test","click")' });
      const harness = await arrange({ enquiries: [enquiry] });
      const sink = createSink();

      await harness.service.streamCsv(admin, query, sink);

      // The receiving spreadsheet shows the text and executes nothing.
      expect(sink.chunks[1]).toContain(`"'=HYPERLINK`);

      await harness.close();
    });

    it('writes an empty cell for a null rather than the word null', async () => {
      const enquiry = buildEnquiry({ eventDate: null, budgetBand: null, lostReason: null });
      const harness = await arrange({ enquiries: [enquiry] });
      const sink = createSink();

      await harness.service.streamCsv(admin, query, sink);

      expect(sink.chunks[1]).not.toContain('null');

      await harness.close();
    });
  });

  it('A-3 — every export is audited, with counts and never with rows', async () => {
    const enquiry = buildEnquiry({ contactEmail: 'sana@example.invalid' });
    const harness = await arrange({ enquiries: [enquiry] });

    await harness.service.streamCsv(admin, query, createSink());

    const audit = harness.events.emit.mock.calls
      .filter(([name]) => name === AUDIT_RECORD_EVENT)
      .map(([, event]) => (event as AuditRecordEvent).input)[0];

    expect(audit).toMatchObject({
      action: AUDIT_ACTIONS.ENQUIRY_EXPORTED,
      actorId: admin.id,
      metadata: { exported: 1 },
    });
    // The point of the export is that contact details leave the system; the audit row
    // records that it happened, not what was in it (E-12).
    expect(JSON.stringify(audit)).not.toContain('sana@example.invalid');

    await harness.close();
  });

  it('names the file by the day it was taken', async () => {
    const harness = await arrange();

    expect(harness.service.filenameFor(new Date('2026-08-15T12:00:00.000Z'))).toBe(
      'drape-enquiries-2026-08-15.csv',
    );

    await harness.close();
  });
});

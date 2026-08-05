import { AppException, ErrorCode } from '@library/common';

import { SettingsService } from '@api/modules/settings';
import { SETTINGS_KEYS } from '@api/shared/constants/settings-keys.constant';

import { buildEnquiry } from '../../../../test/factories';
import { createMock, createTestingModule } from '../../../../test/fixtures';
import { WHATSAPP_TOP_PIECES } from '../constants/enquiry.constants';
import { buildEnquiryItem } from '../testing/enquiry-fixtures';

import { WhatsAppReplyService } from './whatsapp-reply.service';

/**
 * **A-23 — the one-tap reply, and the two things it must never do.**
 *
 * It must never use an admin's own number, and its copy must not undo the §9.4
 * shortlisting framing that every result view carries.
 */
describe('WhatsAppReplyService', () => {
  async function arrange(
    options: { whatsappNumber?: string | null; brandName?: string | null } = {},
  ): Promise<{ service: WhatsAppReplyService; close: () => Promise<void> }> {
    const settings = createMock<SettingsService>(['getString']);
    settings.getString.mockImplementation(async (key: string) => {
      if (key === SETTINGS_KEYS.BRAND_WHATSAPP_NUMBER) {
        return options.whatsappNumber === undefined ? '+92 300 1234567' : options.whatsappNumber;
      }
      if (key === SETTINGS_KEYS.BRAND_NAME) {
        return options.brandName === undefined ? 'Drape' : options.brandName;
      }
      return null;
    });

    const harness = await createTestingModule({
      providers: [WhatsAppReplyService],
      overrides: [{ token: SettingsService, value: settings }],
    });

    return {
      service: harness.get<WhatsAppReplyService>(WhatsAppReplyService),
      close: harness.close,
    };
  }

  const enquiry = buildEnquiry({ contactName: 'Sana Mahmood', reference: 'ENQ-2026-000137' });

  const items = [
    buildEnquiryItem({ enquiryId: enquiry.id, rank: 1, garmentTitleSnapshot: 'Zarrin Lehenga' }),
    buildEnquiryItem({ enquiryId: enquiry.id, rank: 2, garmentTitleSnapshot: 'Ivory Kurta' }),
    buildEnquiryItem({ enquiryId: enquiry.id, rank: 3, garmentTitleSnapshot: 'Gold Sharara' }),
    buildEnquiryItem({ enquiryId: enquiry.id, rank: 4, garmentTitleSnapshot: 'Rose Gharara' }),
  ];

  /* --------------------------------------------------------------------------------------- */

  it('builds a wa.me link from the brand number, digits only', async () => {
    const harness = await arrange({ whatsappNumber: '+92 300 1234567' });

    const reply = await harness.service.buildReply(enquiry, items);

    expect(reply.url.startsWith('https://wa.me/923001234567?text=')).toBe(true);

    await harness.close();
  });

  it('pre-fills her name, her reference and her top pieces (A-23)', async () => {
    const harness = await arrange();

    const { message } = await harness.service.buildReply(enquiry, items);

    expect(message).toContain('Sana');
    expect(message).toContain('ENQ-2026-000137');
    expect(message).toContain('Zarrin Lehenga');

    await harness.close();
  });

  it('names at most the top three, in her rank order', async () => {
    const harness = await arrange();

    const { message } = await harness.service.buildReply(enquiry, [...items].reverse());

    expect(message).toContain('Zarrin Lehenga, Ivory Kurta, Gold Sharara');
    expect(message).not.toContain('Rose Gharara');
    expect(WHATSAPP_TOP_PIECES).toBe(3);

    await harness.close();
  });

  it('refuses clearly when the studio has not set a number', async () => {
    const harness = await arrange({ whatsappNumber: null });

    try {
      await harness.service.buildReply(enquiry, items);
      throw new Error('A link was built with no brand number');
    } catch (error) {
      expect(error).toBeInstanceOf(AppException);
      expect((error as AppException).errorCode).toBe(ErrorCode.SETTINGS_VALUE_INVALID);
    }

    await harness.close();
  });

  describe('§9.4 — the copy is a shortlisting message, not a preview one', () => {
    it('says nothing that promises the render is accurate or final', async () => {
      const harness = await arrange();

      const { message } = await harness.service.buildReply(enquiry, items);
      const lowered = message.toLowerCase();

      for (const forbidden of [
        'see yourself',
        'exactly',
        'accurate',
        'true to life',
        'preview',
        'photorealistic',
        'as it will look',
      ]) {
        expect(lowered).not.toContain(forbidden);
      }

      await harness.close();
    });

    it('says plainly that the piece is judged in person', async () => {
      const harness = await arrange();

      const { message } = await harness.service.buildReply(enquiry, items);

      expect(message).toContain('in person');
      expect(message.toLowerCase()).toContain('shortlisted');

      await harness.close();
    });
  });

  it('never accepts or returns an admin’s own number', async () => {
    const harness = await arrange();

    // The signature takes an enquiry and its items — there is nowhere for an acting
    // admin's number to enter, and nothing on the response for one to leave by.
    const reply = await harness.service.buildReply(enquiry, items);

    expect(Object.keys(reply).sort()).toEqual(['message', 'url']);
    expect(harness.service.buildReply.length).toBe(2);

    await harness.close();
  });
});

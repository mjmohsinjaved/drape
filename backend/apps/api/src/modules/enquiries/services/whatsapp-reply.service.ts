import { Injectable } from '@nestjs/common';

import { ErrorCode, ValidationException } from '@library/common';

import { SettingsService } from '@api/modules/settings';
import { SETTINGS_KEYS } from '@api/shared/constants/settings-keys.constant';

import { WHATSAPP_TOP_PIECES } from '../constants/enquiry.constants';
import { WhatsAppReplyDto } from '../dto/enquiry-response.dto';

import type { EnquiryItem } from '../entities/enquiry-item.entity';
import type { Enquiry } from '../entities/enquiry.entity';

/**
 * **The one-tap WhatsApp reply — PRD A-23, A-27; ARCHITECTURE §5.15.**
 *
 * > A-23: "One-tap WhatsApp reply opening a thread pre-filled with her name and top
 * > pieces."
 *
 * ### The number is the brand's, never the admin's
 *
 * The link is built from `brand.whatsappNumber` in Settings (A-27) and from nothing
 * else. There is no code path here that reads the acting admin's own phone number —
 * the parameter is not accepted, the `users` table is not touched, and the DTO has no
 * field for it. A studio conversation belongs to the studio, and an admin who replies
 * from their personal number has handed a consumer their mobile for good.
 *
 * A studio that has not set a number yet gets a clear refusal rather than a `wa.me/`
 * link to nowhere.
 *
 * ### The copy passes §9.4
 *
 * The message names the pieces she **shortlisted** and proposes seeing them in person.
 * It promises nothing about how a render compares to the garment, it does not present
 * the try-on as a preview, and it says plainly that fabric and detail are judged in
 * the studio. Anything softer would let a message the studio sends undo the caption
 * every result view carries (C-20).
 */
@Injectable()
export class WhatsAppReplyService {
  constructor(private readonly settings: SettingsService) {}

  /** `GET /admin/enquiries/:enquiryId/whatsapp-link` — the A-23 deep link. */
  async buildReply(enquiry: Enquiry, items: readonly EnquiryItem[]): Promise<WhatsAppReplyDto> {
    const [brandNumber, brandName] = await Promise.all([
      this.settings.getString(SETTINGS_KEYS.BRAND_WHATSAPP_NUMBER),
      this.settings.getString(SETTINGS_KEYS.BRAND_NAME),
    ]);

    const digits = (brandNumber ?? '').replace(/\D/g, '');
    if (digits.length === 0) {
      throw new ValidationException(ErrorCode.SETTINGS_VALUE_INVALID, {
        message: 'Add a WhatsApp number in Settings before using the one-tap reply.',
        details: { settingKey: SETTINGS_KEYS.BRAND_WHATSAPP_NUMBER },
      });
    }

    const message = this.composeMessage(enquiry, items, brandName ?? 'the studio');

    const dto = new WhatsAppReplyDto();
    // wa.me wants digits with no `+` and no separators.
    dto.url = `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
    dto.message = message;
    return dto;
  }

  /**
   * Her name, her reference, her top pieces, and a next step.
   *
   * The pieces come from `enquiry_items` in her rank order and are capped at three:
   * this opens in WhatsApp, where a message longer than the preview is a message she
   * has to tap to read.
   */
  private composeMessage(
    enquiry: Enquiry,
    items: readonly EnquiryItem[],
    brandName: string,
  ): string {
    const firstName = enquiry.contactName.trim().split(/\s+/)[0] ?? enquiry.contactName;

    const top = [...items]
      .sort((left, right) => left.rank - right.rank)
      .slice(0, WHATSAPP_TOP_PIECES)
      .map((item) => item.garmentTitleSnapshot)
      .filter((title) => title.length > 0);

    const pieces = top.length === 0 ? 'the pieces you shortlisted' : top.join(', ');

    return (
      `Hello ${firstName}, this is ${brandName} about your enquiry ${enquiry.reference}. ` +
      `You shortlisted ${pieces}. ` +
      'Shall we set a time for you to see them in person? ' +
      'Fabric, embroidery and length all read differently in the studio.'
    );
  }
}

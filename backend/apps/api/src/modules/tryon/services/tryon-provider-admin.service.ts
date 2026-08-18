import { Injectable, Logger } from '@nestjs/common';

import { ErrorCode, ValidationException, type ICurrentUser } from '@library/common';

import {
  OpenAiImageQuality,
  TRYON_DRIVER_NAMES,
  TryOnDriverName,
} from '@api/config/env.validation';
import { SettingsService } from '@api/modules/settings';
import { AUDIT_ACTIONS } from '@api/shared/constants/audit-actions.constant';
import { SETTINGS_KEYS } from '@api/shared/constants/settings-keys.constant';

import { TryOnConfig } from '../config/tryon.config';
import {
  TryOnProviderOptionDto,
  TryOnProviderStateDto,
  type SelectTryOnProviderDto,
} from '../dto/tryon-provider.dto';
import { TryOnProviderResolver } from '../providers/tryon-provider.resolver';

const DRIVER_COPY: Readonly<Record<TryOnDriverName, { label: string; description: string }>> = {
  [TryOnDriverName.MOCK]: {
    label: 'Mock (no upstream)',
    description:
      'Deterministic placeholder renders. Spends nothing and calls nobody. Use it to ' +
      'rehearse the flow or to keep the fitting room open while an upstream is down.',
  },
  [TryOnDriverName.HTTP]: {
    label: 'TryOnCloud',
    description:
      'The purpose-built try-on upstream. Renders land at roughly 20 seconds and are ' +
      'billed per image against the TryOnCloud plan.',
  },
  [TryOnDriverName.GEMINI]: {
    label: 'Google Gemini',
    description:
      'Fastest of the three paid drivers and the cheapest per render. Needs a Google ' +
      'project with paid image quota — a free-tier key answers every request as a rate limit.',
  },
  [TryOnDriverName.OPENAI]: {
    label: 'OpenAI (gpt-image-2)',
    description:
      'Highest fidelity and the most expensive. It reasons before it draws, so renders ' +
      'take noticeably longer, and its safety filter refuses photorealistic photos of ' +
      'people more often than the others. Use the quality dial to trade cost for speed.',
  },
};

const BILLABLE: ReadonlySet<TryOnDriverName> = new Set([
  TryOnDriverName.HTTP,
  TryOnDriverName.GEMINI,
  TryOnDriverName.OPENAI,
]);

const NOT_SELECTABLE: ReadonlySet<TryOnDriverName> = new Set([TryOnDriverName.MOCK]);

@Injectable()
export class TryOnProviderAdminService {
  private readonly logger = new Logger(TryOnProviderAdminService.name);

  constructor(
    private readonly config: TryOnConfig,
    private readonly settings: SettingsService,
    private readonly resolver: TryOnProviderResolver,
  ) {}

  async list(): Promise<TryOnProviderStateDto> {
    const active = await this.resolver.activeDriver();
    const override = await this.settings.getString(SETTINGS_KEYS.TRYON_DRIVER);

    const state = new TryOnProviderStateDto();
    state.active = active;
    state.followingEnvironment = override === null || override.length === 0;
    state.quality = await this.readQuality();
    state.providers = TRYON_DRIVER_NAMES.filter(
      (driver) => !NOT_SELECTABLE.has(driver) || driver === active,
    ).map((driver) => {
      const option = new TryOnProviderOptionDto();
      option.driver = driver;
      option.label = DRIVER_COPY[driver].label;
      option.description = DRIVER_COPY[driver].description;
      option.configured = this.config.isDriverUsable(driver);
      option.active = driver === active;
      option.bootDefault = driver === this.config.driver;
      option.billable = BILLABLE.has(driver);
      option.selectable = !NOT_SELECTABLE.has(driver);
      return option;
    });

    return state;
  }

  async select(dto: SelectTryOnProviderDto, actor: ICurrentUser): Promise<TryOnProviderStateDto> {
    if (NOT_SELECTABLE.has(dto.driver)) {
      throw new ValidationException(ErrorCode.SETTINGS_VALUE_INVALID, {
        message:
          `${DRIVER_COPY[dto.driver].label} cannot be selected from the console — it returns ` +
          `placeholder images rather than real try-ons. Set TRYON_DRIVER on the server if you ` +
          `need it while an upstream is down.`,
        details: { settingKey: SETTINGS_KEYS.TRYON_DRIVER, driver: dto.driver },
      });
    }

    if (!this.config.isDriverUsable(dto.driver)) {
      throw new ValidationException(ErrorCode.SETTINGS_VALUE_INVALID, {
        message:
          `The ${DRIVER_COPY[dto.driver].label} driver is not configured on this ` +
          `deployment. Add its credentials to the API environment and restart before ` +
          `selecting it.`,
        details: { settingKey: SETTINGS_KEYS.TRYON_DRIVER, driver: dto.driver },
      });
    }

    const previous = await this.resolver.activeDriver();

    if (dto.quality !== undefined) {
      await this.settings.setInternal(
        SETTINGS_KEYS.TRYON_OPENAI_QUALITY,
        dto.quality,
        actor,
        AUDIT_ACTIONS.SETTING_UPDATED,
      );
    }

    await this.settings.setInternal(
      SETTINGS_KEYS.TRYON_DRIVER,
      dto.driver,
      actor,
      AUDIT_ACTIONS.TRYON_DRIVER_CHANGED,
    );

    this.logger.warn(
      `The try-on driver was switched from "${previous}" to "${dto.driver}" by ${actor.id}. ` +
        `It applies to the next generation; jobs in flight finish on "${previous}".`,
    );

    return this.list();
  }

  private async readQuality(): Promise<OpenAiImageQuality> {
    const stored = await this.settings.getString(SETTINGS_KEYS.TRYON_OPENAI_QUALITY);
    return (Object.values(OpenAiImageQuality) as string[]).includes(stored ?? '')
      ? (stored as OpenAiImageQuality)
      : OpenAiImageQuality.MEDIUM;
  }
}

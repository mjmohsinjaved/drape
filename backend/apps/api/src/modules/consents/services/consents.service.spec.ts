import { EventEmitter2 } from '@nestjs/event-emitter';
import { getDataSourceToken } from '@nestjs/typeorm';

import { ErrorCode, Locale, Role, UserStatus } from '@library/common';
import type { ICurrentUser } from '@library/common';

import {
  createTestingModule,
  type TestHarness,
  type InMemoryRepository,
} from '../../../../test/fixtures';
import { Consent } from '../entities/consent.entity';
import { PolicyVersion } from '../entities/policy-version.entity';
import { ConsentStatus } from '../enums/consent-status.enum';

import { ConsentsService } from './consents.service';
import { PolicyService } from './policy.service';

const CONSUMER: ICurrentUser = {
  id: 'aa11bb22-cc33-4d44-8e55-ff6677889900',
  role: Role.CONSUMER,
  email: 'ayesha@example.com',
  name: 'Ayesha',
  status: UserStatus.ACTIVE,
  emailVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
  phoneVerifiedAt: null,
  sessionId: '11112222-3333-4444-8555-666677778888',
  locale: Locale.EN,
};

const REQUEST = { ip: '203.0.113.7', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)' };

const JULY = 'policy-july-0000-0000-000000000001';
const SEPTEMBER = 'policy-sept-0000-0000-000000000002';

function policy(id: string, version: string, isCurrent: boolean): PolicyVersion {
  return Object.assign(new PolicyVersion(), {
    id,
    version,
    effectiveFrom: new Date('2026-07-01T00:00:00.000Z'),
    isCurrent,
    bodyEn: 'How your photo is used.',
    bodyUr: 'آپ کی تصویر کیسے استعمال ہوتی ہے۔',
    summaryEn: 'Summary.',
    summaryUr: 'خلاصہ۔',
    retentionSummary: { photoDays: 30, rendersLifetime: true },
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    deletedAt: null,
  });
}

function consent(id: string, policyVersionId: string, version: string, grantedAt: string): Consent {
  return Object.assign(new Consent(), {
    id,
    userId: CONSUMER.id,
    policyVersionId,
    policyVersion: version,
    grantedAt: new Date(grantedAt),
    ip: '203.0.113.7',
    userAgent: 'Mozilla/5.0',
    locale: Locale.EN,
    createdAt: new Date(grantedAt),
  });
}

interface Fixture {
  service: ConsentsService;
  policies: PolicyService;
  consents: InMemoryRepository<Consent>;
  policyVersions: InMemoryRepository<PolicyVersion>;
  harness: TestHarness;
}

async function build(
  policyRows: readonly PolicyVersion[],
  consentRows: readonly Consent[] = [],
): Promise<Fixture> {
  const harness = await createTestingModule({
    providers: [ConsentsService, PolicyService],
    repositories: [
      { entity: Consent, rows: consentRows },
      { entity: PolicyVersion, rows: policyRows },
    ],
    overrides: [
      { token: EventEmitter2, value: new EventEmitter2() },
      // PolicyService injects a DataSource for `publish()` only; nothing here reaches it.
      { token: getDataSourceToken(), value: {} },
    ],
  });

  return {
    service: harness.get(ConsentsService),
    policies: harness.get(PolicyService),
    consents: harness.repository<Consent>(Consent),
    policyVersions: harness.repository<PolicyVersion>(PolicyVersion),
    harness,
  };
}

describe('ConsentsService — the C-12 consent predicate', () => {
  it('reports REQUIRED when she has never consented', async () => {
    const { service, harness } = await build([policy(JULY, '2026.07.1', true)]);

    const status = await service.resolveStatus(CONSUMER.id);

    expect(status).toMatchObject({
      status: ConsentStatus.REQUIRED,
      grantedAt: null,
      policyVersion: '2026.07.1',
      consentedPolicyVersion: null,
    });
    await expect(service.hasCurrentConsent(CONSUMER.id)).resolves.toBe(false);

    await harness.close();
  });

  it('reports GRANTED once she has consented at the current version', async () => {
    const { service, harness } = await build(
      [policy(JULY, '2026.07.1', true)],
      [consent('c1', JULY, '2026.07.1', '2026-07-10T09:00:00.000Z')],
    );

    const status = await service.resolveStatus(CONSUMER.id);

    expect(status.status).toBe(ConsentStatus.GRANTED);
    expect(status.consentedPolicyVersion).toBe('2026.07.1');
    await expect(service.hasCurrentConsent(CONSUMER.id)).resolves.toBe(true);
    await expect(service.assertConsentIsCurrent(CONSUMER.id)).resolves.toBeUndefined();

    await harness.close();
  });

  it('turns GRANTED into STALE the moment a new version becomes current', async () => {
    // The whole point of C-12: no write against her row, no backfill, no migration —
    // publishing a version re-gates everyone because consent is derived, not stored.
    const { service, policies, policyVersions, harness } = await build(
      [policy(JULY, '2026.07.1', true)],
      [consent('c1', JULY, '2026.07.1', '2026-07-10T09:00:00.000Z')],
    );

    await expect(service.hasCurrentConsent(CONSUMER.id)).resolves.toBe(true);

    // An admin publishes 2026.09.1.
    policyVersions.$rows[0].isCurrent = false;
    policyVersions.$rows.push(policy(SEPTEMBER, '2026.09.1', true));
    policies.invalidate();

    const status = await service.resolveStatus(CONSUMER.id);

    expect(status).toMatchObject({
      status: ConsentStatus.STALE,
      policyVersion: '2026.09.1',
      consentedPolicyVersion: '2026.07.1',
    });
    expect(status.grantedAt).toEqual(new Date('2026-07-10T09:00:00.000Z'));
    await expect(service.hasCurrentConsent(CONSUMER.id)).resolves.toBe(false);

    await harness.close();
  });

  it('returns to GRANTED after she re-consents at the new version', async () => {
    const { service, harness } = await build(
      [policy(JULY, '2026.07.1', false), policy(SEPTEMBER, '2026.09.1', true)],
      [
        consent('c1', JULY, '2026.07.1', '2026-07-10T09:00:00.000Z'),
        consent('c2', SEPTEMBER, '2026.09.1', '2026-09-02T11:30:00.000Z'),
      ],
    );

    const status = await service.resolveStatus(CONSUMER.id);

    expect(status.status).toBe(ConsentStatus.GRANTED);
    expect(status.consentedPolicyVersion).toBe('2026.09.1');

    await harness.close();
  });

  it('throws the guard-chain codes §8.1 step 3 expects, in the right cases', async () => {
    const never = await build([policy(JULY, '2026.07.1', true)]);
    await expect(never.service.assertConsentIsCurrent(CONSUMER.id)).rejects.toMatchObject({
      errorCode: ErrorCode.CONSENT_REQUIRED,
    });
    await never.harness.close();

    const stale = await build(
      [policy(JULY, '2026.07.1', false), policy(SEPTEMBER, '2026.09.1', true)],
      [consent('c1', JULY, '2026.07.1', '2026-07-10T09:00:00.000Z')],
    );
    await expect(stale.service.assertConsentIsCurrent(CONSUMER.id)).rejects.toMatchObject({
      errorCode: ErrorCode.CONSENT_STALE,
    });
    await stale.harness.close();
  });

  it('surfaces CONSENT_POLICY_NOT_FOUND when no version is current', async () => {
    const { service, harness } = await build([policy(JULY, '2026.07.1', false)]);

    await expect(service.resolveStatus(CONSUMER.id)).rejects.toMatchObject({
      errorCode: ErrorCode.CONSENT_POLICY_NOT_FOUND,
    });

    await harness.close();
  });
});

describe('ConsentsService.record — append-only (§4.11)', () => {
  it('records timestamp, IP, user agent, locale and policy version (C-12)', async () => {
    const { service, consents, harness } = await build([policy(JULY, '2026.07.1', true)]);

    await service.record(
      CONSUMER,
      { policyVersion: '2026.07.1', accepted: true, locale: Locale.UR },
      REQUEST,
    );

    expect(consents.$rows).toHaveLength(1);
    expect(consents.$rows[0]).toMatchObject({
      userId: CONSUMER.id,
      policyVersionId: JULY,
      policyVersion: '2026.07.1',
      ip: REQUEST.ip,
      userAgent: REQUEST.userAgent,
      locale: Locale.UR,
    });
    expect(consents.$rows[0].grantedAt).toBeInstanceOf(Date);

    await harness.close();
  });

  it('inserts a second row on re-consent instead of updating the first', async () => {
    // §4.11 carries no unique index for exactly this reason: the July row is the
    // evidence of what she agreed to in July, and editing it would destroy that.
    const first = consent('c1', JULY, '2026.07.1', '2026-07-10T09:00:00.000Z');
    const { service, consents, harness } = await build(
      [policy(JULY, '2026.07.1', false), policy(SEPTEMBER, '2026.09.1', true)],
      [first],
    );

    await service.record(CONSUMER, { policyVersion: '2026.09.1', accepted: true }, REQUEST);

    expect(consents.$rows).toHaveLength(2);
    // The original row is byte-for-byte what it was.
    expect(consents.$rows[0]).toEqual(first);
    expect(consents.$rows[0].policyVersion).toBe('2026.07.1');
    expect(consents.$rows[1].policyVersion).toBe('2026.09.1');
    // Nothing was updated, and nothing was removed.
    expect(consents.update).not.toHaveBeenCalled();
    expect(consents.softDelete).not.toHaveBeenCalled();
    expect(consents.delete).not.toHaveBeenCalled();

    await harness.close();
  });

  it('records a repeat consent at the same version as a further row, never an overwrite', async () => {
    const { service, consents, harness } = await build(
      [policy(JULY, '2026.07.1', true)],
      [consent('c1', JULY, '2026.07.1', '2026-07-10T09:00:00.000Z')],
    );

    await service.record(CONSUMER, { policyVersion: '2026.07.1', accepted: true }, REQUEST);

    expect(consents.$rows).toHaveLength(2);
    expect(consents.update).not.toHaveBeenCalled();

    await harness.close();
  });

  it('refuses a consent submitted against a superseded version', async () => {
    const { service, consents, harness } = await build([
      policy(JULY, '2026.07.1', false),
      policy(SEPTEMBER, '2026.09.1', true),
    ]);

    await expect(
      service.record(CONSUMER, { policyVersion: '2026.07.1', accepted: true }, REQUEST),
    ).rejects.toMatchObject({ errorCode: ErrorCode.RESOURCE_CONFLICT });

    expect(consents.$rows).toHaveLength(0);

    await harness.close();
  });

  it('truncates an over-long user agent to the varchar(512) column', async () => {
    const { service, consents, harness } = await build([policy(JULY, '2026.07.1', true)]);

    await service.record(
      CONSUMER,
      { policyVersion: '2026.07.1', accepted: true },
      {
        ip: REQUEST.ip,
        userAgent: 'x'.repeat(900),
      },
    );

    expect(consents.$rows[0].userAgent).toHaveLength(512);

    await harness.close();
  });
});

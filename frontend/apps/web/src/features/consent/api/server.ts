import 'server-only';

import { consentPaths } from '@/features/consent/api/endpoints';
import { serverGet, type ServerResult } from '@/lib/server-api';


import type { ApiLocale, MyConsentState, PolicyDocument } from '@/features/consent/api/types';

/**
 * Server-side consent reads (B-9).
 *
 * The gate is server-rendered because it is the one screen she must be able to *read* before
 * anything else happens — a policy that arrives after a client round trip is a policy she is
 * likely to scroll past. `GET /consents/policy` is public, so this also works before the session
 * has been established.
 */

export async function getPolicyServer(locale: ApiLocale): Promise<ServerResult<PolicyDocument>> {
  return serverGet<PolicyDocument>(consentPaths.policy, { params: { locale } });
}

export async function getMyConsentServer(): Promise<ServerResult<MyConsentState>> {
  return serverGet<MyConsentState>(consentPaths.me);
}

import { apiClient } from '@repo/api-client';

import type {
  ApiLocale,
  GrantConsentBody,
  MyConsentState,
  PolicyDocument,
} from '@/features/consent/api/types';

/**
 * Consent calls — ARCHITECTURE §5.10.
 *
 * The two reads have server-side twins in `./server` for the Server Component that renders the
 * gate; this module is the browser half, and the only mutation on it is the one she performs
 * herself.
 */

export const consentPaths = {
  policy: '/consents/policy',
  me: '/consents/me',
  grant: '/consents',
} as const;

export async function getPolicy(locale: ApiLocale): Promise<PolicyDocument> {
  const response = await apiClient.get<PolicyDocument>(consentPaths.policy, {
    params: { locale },
  });
  return response.data;
}

export async function getMyConsent(): Promise<MyConsentState> {
  const response = await apiClient.get<MyConsentState>(consentPaths.me);
  return response.data;
}

export async function grantConsent(body: GrantConsentBody): Promise<MyConsentState> {
  const response = await apiClient.post<MyConsentState>(consentPaths.grant, body);
  return response.data;
}

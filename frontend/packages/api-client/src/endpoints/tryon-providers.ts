import { get, put, type EndpointOptions } from './http';

import type { SelectTryOnProviderRequest, TryOnProviderState } from '../types/tryon';

export const tryOnProviderPaths = {
  providers: '/admin/tryon/providers',
  provider: '/admin/tryon/provider',
} as const;

export async function getTryOnProviders(options?: EndpointOptions): Promise<TryOnProviderState> {
  return get<TryOnProviderState>(tryOnProviderPaths.providers, options);
}

export async function selectTryOnProvider(
  body: SelectTryOnProviderRequest,
  options?: EndpointOptions,
): Promise<TryOnProviderState> {
  return put<TryOnProviderState, SelectTryOnProviderRequest>(
    tryOnProviderPaths.provider,
    body,
    options,
  );
}

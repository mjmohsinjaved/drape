import {
  tryOnProviderApi,
  type SelectTryOnProviderRequest,
  type TryOnProviderState,
} from '@repo/api-client';

export async function getTryOnProviders(signal?: AbortSignal): Promise<TryOnProviderState> {
  return tryOnProviderApi.getTryOnProviders({ signal });
}

export async function selectTryOnProvider(
  body: SelectTryOnProviderRequest,
): Promise<TryOnProviderState> {
  return tryOnProviderApi.selectTryOnProvider(body);
}

import {
  apiClient,
  type Paginated,
  type Uuid,
  type AdminConsumerDetail,
  type AdminConsumerListItem,
  type AdminConsumerListQuery,
  type SuspendConsumerRequest,
} from '@repo/api-client';

/** Path builders, so no URL is assembled from string parts at a call site. */
export const consumerPaths = {
  consumers: '/admin/consumers',
  consumer: (userId: Uuid): string => `/admin/consumers/${userId}`,
  suspend: (userId: Uuid): string => `/admin/consumers/${userId}/suspend`,
  unsuspend: (userId: Uuid): string => `/admin/consumers/${userId}/unsuspend`,
} as const;

/**
 * The A-16 consumer list — ARCHITECTURE §5.2.
 *
 * `ConsumerListItemResponseDto` is the one consumer-shaped list DTO in the API that carries an
 * email and a phone number, and A-16 is what authorises it. Nothing here widens that: the query
 * goes to the same guarded route, and what comes back is what the admin is allowed to see.
 */
export async function listConsumers(
  query: AdminConsumerListQuery,
  signal?: AbortSignal,
): Promise<Paginated<AdminConsumerListItem>> {
  const response = await apiClient.get<Paginated<AdminConsumerListItem>>(consumerPaths.consumers, {
    params: query,
    signal,
  });
  return response.data;
}

/** Consumer detail (A-17). Never includes her photo — there is no field for one (S-10). */
export async function getConsumer(
  userId: Uuid,
  signal?: AbortSignal,
): Promise<AdminConsumerDetail> {
  const response = await apiClient.get<AdminConsumerDetail>(consumerPaths.consumer(userId), {
    signal,
  });
  return response.data;
}

/**
 * `POST /admin/consumers/:userId/suspend` — A-19.
 *
 * The API does the whole thing: it sets the status, stores the reason, **revokes every live
 * session for that account**, emails her, and writes the audit row. From then on her password
 * still verifies but `assertAccountUsable` refuses the login with `ACCOUNT_SUSPENDED`, and
 * `SessionResolver` declines any request that arrives on a cookie issued earlier.
 */
export async function suspendConsumer(
  userId: Uuid,
  body: SuspendConsumerRequest,
): Promise<AdminConsumerDetail> {
  const response = await apiClient.post<AdminConsumerDetail>(consumerPaths.suspend(userId), body);
  return response.data;
}

/** `POST /admin/consumers/:userId/unsuspend` — lifts the hold and clears the reason. */
export async function unsuspendConsumer(userId: Uuid): Promise<AdminConsumerDetail> {
  const response = await apiClient.post<AdminConsumerDetail>(consumerPaths.unsuspend(userId));
  return response.data;
}

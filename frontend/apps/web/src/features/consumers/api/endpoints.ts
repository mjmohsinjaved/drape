import {
  apiClient,
  type Paginated,
  type Uuid,
  type AdminConsumerDetail,
  type AdminConsumerListItem,
  type AdminConsumerListQuery,
  type SuspendConsumerRequest,
} from '@repo/api-client';

export const consumerPaths = {
  consumers: '/admin/consumers',
  consumer: (userId: Uuid): string => `/admin/consumers/${userId}`,
  approve: (userId: Uuid): string => `/admin/consumers/${userId}/approve`,
  suspend: (userId: Uuid): string => `/admin/consumers/${userId}/suspend`,
  unsuspend: (userId: Uuid): string => `/admin/consumers/${userId}/unsuspend`,
} as const;

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

export async function getConsumer(
  userId: Uuid,
  signal?: AbortSignal,
): Promise<AdminConsumerDetail> {
  const response = await apiClient.get<AdminConsumerDetail>(consumerPaths.consumer(userId), {
    signal,
  });
  return response.data;
}

export async function suspendConsumer(
  userId: Uuid,
  body: SuspendConsumerRequest,
): Promise<AdminConsumerDetail> {
  const response = await apiClient.post<AdminConsumerDetail>(consumerPaths.suspend(userId), body);
  return response.data;
}

export async function unsuspendConsumer(userId: Uuid): Promise<AdminConsumerDetail> {
  const response = await apiClient.post<AdminConsumerDetail>(consumerPaths.unsuspend(userId));
  return response.data;
}

export async function approveConsumer(userId: Uuid): Promise<AdminConsumerDetail> {
  const response = await apiClient.post<AdminConsumerDetail>(consumerPaths.approve(userId));
  return response.data;
}

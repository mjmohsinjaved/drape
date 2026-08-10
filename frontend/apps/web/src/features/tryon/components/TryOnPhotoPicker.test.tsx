// @vitest-environment jsdom

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/harness';

import { TryOnPhotoPicker } from './TryOnPhotoPicker';

import type { PersonPhoto } from '@/features/photos/api/types';

/**
 * The photo picker on the garment page.
 *
 * The behaviour worth pinning is not that it renders a list — it is the three answers a consumer
 * needs before she spends a generation, each of which was previously only obtainable by leaving
 * the piece and going to `/photos`:
 *
 *  - which photograph this try-on will use;
 *  - that she can change it without losing her place;
 *  - what to do when she has no usable photograph at all.
 *
 * The messages are the real catalogue, so these also prove the `tryon.photoPicker` keys resolve.
 */

const listPhotos = vi.fn<() => Promise<PersonPhoto[]>>();
const activatePhoto = vi.fn<(photoId: string) => Promise<PersonPhoto>>();

vi.mock('@/features/photos/api/endpoints', () => ({
  listPhotos: () => listPhotos(),
  activatePhoto: (photoId: string) => activatePhoto(photoId),
}));

function photo(overrides: Partial<PersonPhoto> & { id: string }): PersonPhoto {
  return {
    url: `https://api.test/files/${overrides.id}`,
    isActive: false,
    label: null,
    moderationState: 'APPROVED',
    width: 1000,
    height: 1500,
    byteSize: 120_000,
    mimeType: 'image/jpeg',
    uploadedAt: '2026-08-01T10:00:00.000Z',
    purgeAfter: '2026-09-01T10:00:00.000Z',
    createdAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  };
}

async function renderPicker(): Promise<void> {
  await renderWithProviders(<TryOnPhotoPicker locale="en" returnTo="/en/garments/a-lehenga" />);
}

beforeEach(() => {
  listPhotos.mockReset();
  activatePhoto.mockReset();
});

describe('TryOnPhotoPicker', () => {
  it('names the photograph the generation will use', async () => {
    listPhotos.mockResolvedValue([
      photo({ id: 'p1', label: 'Daylight', isActive: true }),
      photo({ id: 'p2', label: 'Indoors' }),
    ]);

    await renderPicker();

    expect(await screen.findByText(/Daylight/)).toBeDefined();
  });

  it('switches the active photograph without leaving the garment', async () => {
    const user = userEvent.setup();
    listPhotos.mockResolvedValue([
      photo({ id: 'p1', label: 'Daylight', isActive: true }),
      photo({ id: 'p2', label: 'Indoors' }),
    ]);
    activatePhoto.mockResolvedValue(photo({ id: 'p2', label: 'Indoors', isActive: true }));

    await renderPicker();
    await user.click(await screen.findByRole('button', { name: /use a different photo/i }));
    await user.click(await screen.findByRole('button', { name: /Indoors/ }));

    await waitFor(() => {
      expect(activatePhoto).toHaveBeenCalledWith('p2');
    });
  });

  it('offers to add one when she has no photograph, rather than waiting for the button to fail', async () => {
    listPhotos.mockResolvedValue([]);

    await renderPicker();

    const add = await screen.findByRole('link', { name: /add a photo/i });
    expect(add.getAttribute('href')).toContain('/en/photos/new');
    // Carries her back to the piece she was looking at, rather than dumping her on the grid.
    expect(add.getAttribute('href')).toContain(encodeURIComponent('/en/garments/a-lehenga'));
  });

  it('treats a blocked photograph as no photograph, and never says why', async () => {
    listPhotos.mockResolvedValue([photo({ id: 'p1', moderationState: 'BLOCKED' })]);

    await renderPicker();

    // The empty state, because a blocked photo cannot be generated from. The copy is the neutral
    // "no photo yet" — disclosing the moderation outcome here would disclose it to whoever is
    // looking over her shoulder.
    expect(await screen.findByRole('link', { name: /add a photo/i })).toBeDefined();
    expect(screen.queryByText(/blocked|rejected|moderation/i)).toBeNull();
  });

  it('stays out of the way when the list cannot be read, so the try-on button still renders', async () => {
    listPhotos.mockRejectedValue(new Error('offline'));

    const { container } = await renderWithProviders(
      <TryOnPhotoPicker locale="en" returnTo="/en/garments/a-lehenga" />,
    );

    // The API decides whether she may generate and will use her active photo regardless; a failed
    // read here must not become a blocker above the one control on the screen.
    await waitFor(() => {
      expect(container.innerHTML).toBe('');
    });
  });
});

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { GarmentImageBatchDto, MAX_BATCH_GARMENT_IMAGES } from './garment-image-batch.dto';

/**
 * `POST /admin/garment-images/batch` — §5.7, §6.2, §2.8.
 *
 * The ceiling is the whole point of this DTO. §2.8 caps a list page at 100 and this
 * endpoint exists to serve exactly one such page of the catalog table, so a longer list is
 * not a page — and it is **refused, not clamped**. A silently truncated response would
 * leave the table unable to tell which of its rows it did not get an answer for, which is
 * the same class of bug as omitting the garments that have no image.
 */
describe('GarmentImageBatchDto — the batch is bounded, non-empty and unique (§2.8)', () => {
  async function errorsFor(garmentIds: unknown): Promise<string[]> {
    const dto = plainToInstance(GarmentImageBatchDto, { garmentIds });
    const errors = await validate(dto);
    return errors.flatMap((error) => Object.keys(error.constraints ?? {}));
  }

  function ids(count: number): string[] {
    return Array.from(
      { length: count },
      (_unused, index) => `00000000-0000-4000-8000-${`${index}`.padStart(12, '0')}`,
    );
  }

  it('accepts a full page of ids', async () => {
    expect(await errorsFor(ids(MAX_BATCH_GARMENT_IMAGES))).toEqual([]);
  });

  it('refuses one id past the ceiling rather than truncating the answer', async () => {
    expect(await errorsFor(ids(MAX_BATCH_GARMENT_IMAGES + 1))).toContain('arrayMaxSize');
  });

  it('matches §2.8’s page ceiling, so the table never has to split a request', async () => {
    expect(MAX_BATCH_GARMENT_IMAGES).toBe(100);
  });

  it('refuses an empty list', async () => {
    expect(await errorsFor([])).toContain('arrayNotEmpty');
  });

  it('refuses a repeated id, so one row cannot be answered twice', async () => {
    const [first] = ids(1);
    expect(await errorsFor([first, first])).toContain('arrayUnique');
  });

  it('refuses anything that is not a uuid', async () => {
    expect(await errorsFor(['not-a-uuid'])).toContain('isUuid');
  });

  it('refuses a body that is not a list at all', async () => {
    expect(await errorsFor('00000000-0000-4000-8000-000000000000')).toContain('isArray');
  });
});

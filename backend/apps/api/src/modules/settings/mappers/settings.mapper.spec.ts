import { SETTINGS_REGISTRY, type SettingsKey } from '@api/shared/constants/settings-keys.constant';

import { SettingsValueType } from '../enums/settings-value-type.enum';

import { toBrandSettingsResponse } from './settings.mapper';

/**
 * A-27 / §5.4 — `GET /settings/brand` is the one public settings route, and the one
 * place a private key could leak.
 *
 * These tests do not check a hand-written list of fields against another hand-written
 * list of fields: two lists that agree today drift apart the moment someone adds a
 * key. They walk `SETTINGS_REGISTRY` — the authoritative registry — and assert the
 * projection against what the registry says about each key.
 */

/** A value that is legal for the key's type and unmistakable if it turns up in output. */
function sentinelFor(key: SettingsKey, valueType: SettingsValueType, index: number): unknown {
  switch (valueType) {
    case SettingsValueType.STRING:
      // `brand.logoKey` has to stay a legal storage key or the mapper would sign
      // nonsense; every other string carries a traceable marker.
      return key === 'brand.logoKey'
        ? 'brand/0c0a1b2c-3d4e-4f50-8a6b-7c8d9e0f1a2b.png'
        : `SENTINEL_${index}_${key}`;
    case SettingsValueType.NUMBER:
      // Distinctive enough that a stringified response containing it is unambiguous.
      return 900_000 + index;
    case SettingsValueType.BOOLEAN:
      return true;
    case SettingsValueType.JSON:
      return [{ label: `SENTINEL_${index}_${key}`, address: `SENTINEL_${index}_${key}` }];
    default:
      return null;
  }
}

/** Every registered key set to a sentinel, public and private alike. */
function seedEveryKey(): {
  values: Map<SettingsKey, unknown>;
  sentinels: Map<SettingsKey, string>;
} {
  const values = new Map<SettingsKey, unknown>();
  const sentinels = new Map<SettingsKey, string>();

  SETTINGS_REGISTRY.forEach((definition, index) => {
    values.set(definition.key, sentinelFor(definition.key, definition.valueType, index));
    sentinels.set(definition.key, `SENTINEL_${index}_${definition.key}`);
    if (definition.valueType === SettingsValueType.NUMBER) {
      sentinels.set(definition.key, String(900_000 + index));
    }
  });

  return { values, sentinels };
}

/** The signer never echoes the key back, so a leak cannot hide inside the URL. */
const sign = (): string => 'https://api.test/api/v1/files/signed-token';

/**
 * A settings map that records every key the mapper looks at.
 *
 * This is what turns "no private key leaked into the output" into "no private key was
 * even read". The first is a property of one set of fixture values; the second is a
 * property of the code, and it holds for values nobody has thought of yet.
 */
class RecordingMap extends Map<SettingsKey, unknown> {
  readonly reads: SettingsKey[] = [];

  override get(key: SettingsKey): unknown {
    this.reads.push(key);
    return super.get(key);
  }
}

describe('toBrandSettingsResponse — the public projection (A-27)', () => {
  it('never so much as reads a key the registry marks private', () => {
    const { values } = seedEveryKey();
    const recorded = new RecordingMap(values);

    toBrandSettingsResponse(recorded, sign);

    const publicKeys = new Set(
      SETTINGS_REGISTRY.filter((definition) => definition.isPublic).map(
        (definition) => definition.key,
      ),
    );
    const privateKeys = SETTINGS_REGISTRY.filter((definition) => !definition.isPublic);

    // Guard against a vacuous pass: the registry must actually hold private keys.
    expect(privateKeys.length).toBeGreaterThan(0);
    expect(publicKeys.size).toBeGreaterThan(0);

    // The strong claim: a non-public key is not merely absent from the response, it
    // never entered the projection at all.
    expect(recorded.reads.filter((key) => !publicKeys.has(key))).toEqual([]);
    // And every public key was read, so nothing the registry promises is skipped.
    expect(new Set(recorded.reads)).toEqual(publicKeys);
  });

  it('leaks no value belonging to a non-public key', () => {
    const { values, sentinels } = seedEveryKey();

    const serialised = JSON.stringify(toBrandSettingsResponse(values, sign));

    const privateKeys = SETTINGS_REGISTRY.filter((definition) => !definition.isPublic);
    // Guard against the test passing because the registry has no private keys at all.
    expect(privateKeys.length).toBeGreaterThan(0);

    for (const definition of privateKeys) {
      const sentinel = sentinels.get(definition.key) as string;
      expect(serialised).not.toContain(sentinel);
      expect(serialised).not.toContain(definition.key);
    }
  });

  it('projects exactly one field per public key — no more, no fewer', () => {
    const { values } = seedEveryKey();

    const dto = toBrandSettingsResponse(values, sign);

    // Registry-driven on both sides: a new public key with no field fails here, and
    // so does a field with no public key behind it.
    expect(Object.keys(dto)).toHaveLength(
      SETTINGS_REGISTRY.filter((definition) => definition.isPublic).length,
    );
  });

  it('carries the value of every non-boolean public key through to the response', () => {
    const { values, sentinels } = seedEveryKey();

    const serialised = JSON.stringify(toBrandSettingsResponse(values, sign));

    for (const definition of SETTINGS_REGISTRY.filter((entry) => entry.isPublic)) {
      if (definition.key === 'brand.logoKey') {
        // Projected as a signed URL — the key itself must not appear (§3.4, E-12).
        expect(serialised).toContain('https://api.test/api/v1/files/signed-token');
        expect(serialised).not.toContain('brand/0c0a1b2c');
        continue;
      }
      if (definition.valueType === SettingsValueType.BOOLEAN) {
        // A boolean carries no sentinel; the A-30 toggles are covered below.
        continue;
      }
      expect(serialised).toContain(sentinels.get(definition.key) as string);
    }
  });

  it('carries each A-30 toggle through rather than defaulting it to true', () => {
    const values = new Map<SettingsKey, unknown>([
      ['catalog.showPricesPublicly', false],
      ['sharing.enabled', false],
      ['enquiries.enabled', false],
    ]);

    const dto = toBrandSettingsResponse(values, sign);

    expect(dto.showPricesPublicly).toBe(false);
    expect(dto.sharingEnabled).toBe(false);
    expect(dto.enquiriesEnabled).toBe(false);
  });

  it('never exposes the raw storage key of the brand logo', () => {
    const values = new Map<SettingsKey, unknown>([
      ['brand.logoKey', 'brand/0c0a1b2c-3d4e-4f50-8a6b-7c8d9e0f1a2b.png'],
    ]);
    const signed = jest.fn().mockReturnValue('https://api.test/api/v1/files/opaque-token');

    const dto = toBrandSettingsResponse(values, signed);

    expect(signed).toHaveBeenCalledWith('brand/0c0a1b2c-3d4e-4f50-8a6b-7c8d9e0f1a2b.png');
    expect(dto.logoUrl).toBe('https://api.test/api/v1/files/opaque-token');
    expect(JSON.stringify(dto)).not.toContain('brand/');
  });

  it('renders a null logo when no asset has been uploaded', () => {
    const dto = toBrandSettingsResponse(new Map<SettingsKey, unknown>(), sign);

    expect(dto.logoUrl).toBeNull();
    // Registry defaults still hold the shape together.
    expect(dto.name).toBe('Drape');
    expect(dto.primaryColor).toBe('#71202F');
    expect(dto.storeAddresses).toEqual([]);
  });

  it('drops a malformed address rather than emitting a half-built one', () => {
    const values = new Map<SettingsKey, unknown>([
      [
        'brand.storeAddresses',
        [
          { label: 'Gulberg Flagship', address: '12-C Main Boulevard', city: 'Lahore' },
          { label: 'No street here' },
          'not an object',
        ],
      ],
    ]);

    const dto = toBrandSettingsResponse(values, sign);

    expect(dto.storeAddresses).toEqual([
      { label: 'Gulberg Flagship', address: '12-C Main Boulevard', city: 'Lahore' },
    ]);
  });

  it('has a projection for every public key in the registry', () => {
    // The mapper throws when the registry gains a public key it cannot project. This
    // asserts the current registry is fully covered, so that throw stays theoretical.
    expect(() => toBrandSettingsResponse(new Map<SettingsKey, unknown>(), sign)).not.toThrow();
  });
});

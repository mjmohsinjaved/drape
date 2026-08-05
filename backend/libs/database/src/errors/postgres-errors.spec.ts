import {
  DEADLOCK_DETECTED,
  isSerializationFailure,
  isUniqueViolation,
  SERIALIZATION_FAILURE,
  sqlStateOf,
  UNIQUE_VIOLATION,
} from './postgres-errors';

/** What TypeORM actually throws: the driver's error wrapped, with no `code` on the wrapper. */
function wrapped(code: string): unknown {
  const error = new Error('duplicate key value violates unique constraint') as Error & {
    query: string;
    driverError: { code: string };
  };
  error.query = 'INSERT INTO "enquiries" ...';
  error.driverError = { code };
  return error;
}

describe('sqlStateOf', () => {
  it('reads the code off a bare driver error', () => {
    expect(sqlStateOf({ code: UNIQUE_VIOLATION })).toBe(UNIQUE_VIOLATION);
  });

  it('unwraps the code TypeORM hangs off `driverError`', () => {
    expect(sqlStateOf(wrapped(UNIQUE_VIOLATION))).toBe(UNIQUE_VIOLATION);
  });

  it('prefers the wrapped code, exactly as GlobalExceptionFilter does', () => {
    expect(sqlStateOf({ code: 'ER_WRAPPER', driverError: { code: UNIQUE_VIOLATION } })).toBe(
      UNIQUE_VIOLATION,
    );
  });

  it('is total — nothing it is handed can make it throw', () => {
    expect(sqlStateOf(null)).toBeUndefined();
    expect(sqlStateOf(undefined)).toBeUndefined();
    expect(sqlStateOf('23505')).toBeUndefined();
    expect(sqlStateOf({ code: 23_505 })).toBeUndefined();
  });
});

describe('isUniqueViolation', () => {
  it('recognises the violation whether or not TypeORM wrapped it', () => {
    expect(isUniqueViolation({ code: UNIQUE_VIOLATION })).toBe(true);
    expect(isUniqueViolation(wrapped(UNIQUE_VIOLATION))).toBe(true);
  });

  it('refuses anything that is not 23505 — a dropped connection must still surface', () => {
    expect(isUniqueViolation(wrapped('08006'))).toBe(false);
    expect(isUniqueViolation(new Error('boom'))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});

describe('isSerializationFailure', () => {
  it('recognises both codes, wrapped or not', () => {
    expect(isSerializationFailure({ code: SERIALIZATION_FAILURE })).toBe(true);
    expect(isSerializationFailure({ code: DEADLOCK_DETECTED })).toBe(true);
    expect(isSerializationFailure(wrapped(SERIALIZATION_FAILURE))).toBe(true);
    expect(isSerializationFailure(wrapped(DEADLOCK_DETECTED))).toBe(true);
  });

  it('does not treat a constraint violation as a retryable conflict', () => {
    expect(isSerializationFailure(wrapped(UNIQUE_VIOLATION))).toBe(false);
  });
});

import { Logger } from '@nestjs/common';

import { runInTransaction } from './transaction.helper';

import type { DataSource, EntityManager } from 'typeorm';

interface MockQueryRunner {
  manager: EntityManager;
  isTransactionActive: boolean;
  connect: jest.Mock;
  startTransaction: jest.Mock;
  commitTransaction: jest.Mock;
  rollbackTransaction: jest.Mock;
  release: jest.Mock;
}

function mockQueryRunner(): MockQueryRunner {
  return {
    manager: { marker: 'transactional-manager' } as unknown as EntityManager,
    isTransactionActive: true,
    connect: jest.fn().mockResolvedValue(undefined),
    startTransaction: jest.fn().mockResolvedValue(undefined),
    commitTransaction: jest.fn().mockResolvedValue(undefined),
    rollbackTransaction: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
  };
}

function mockDataSource(queryRunner: MockQueryRunner): DataSource {
  return { createQueryRunner: jest.fn(() => queryRunner) } as unknown as DataSource;
}

describe('runInTransaction', () => {
  let queryRunner: MockQueryRunner;
  let dataSource: DataSource;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    queryRunner = mockQueryRunner();
    dataSource = mockDataSource(queryRunner);
  });

  describe('happy path', () => {
    it('connects, starts, commits, releases — in that order — and returns the result', async () => {
      const order: string[] = [];
      queryRunner.connect.mockImplementation(async () => void order.push('connect'));
      queryRunner.startTransaction.mockImplementation(async () => void order.push('start'));
      queryRunner.commitTransaction.mockImplementation(async () => void order.push('commit'));
      queryRunner.release.mockImplementation(async () => void order.push('release'));

      const result = await runInTransaction(dataSource, async () => {
        order.push('work');
        return 'saved-id';
      });

      expect(result).toBe('saved-id');
      expect(order).toEqual(['connect', 'start', 'work', 'commit', 'release']);
      expect(queryRunner.rollbackTransaction).not.toHaveBeenCalled();
    });

    it('hands the callback the transactional EntityManager, not the global one', async () => {
      const work = jest.fn().mockResolvedValue(undefined);

      await runInTransaction(dataSource, work);

      expect(work).toHaveBeenCalledWith(queryRunner.manager);
    });

    it('starts with the server default isolation level unless one is given', async () => {
      await runInTransaction(dataSource, async () => undefined);

      expect(queryRunner.startTransaction).toHaveBeenCalledWith();
    });

    it('passes an explicit isolation level through to startTransaction', async () => {
      await runInTransaction(dataSource, async () => undefined, {
        isolationLevel: 'SERIALIZABLE',
      });

      expect(queryRunner.startTransaction).toHaveBeenCalledWith('SERIALIZABLE');
    });
  });

  describe('when the callback throws', () => {
    it('rolls back, never commits, and rethrows the original error', async () => {
      const cause = new Error('quota would go negative');

      await expect(
        runInTransaction(dataSource, async () => {
          throw cause;
        }),
      ).rejects.toBe(cause);

      expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
    });

    it('releases the query runner even though it threw', async () => {
      await expect(
        runInTransaction(dataSource, async () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');

      expect(queryRunner.release).toHaveBeenCalledTimes(1);
    });

    it('rolls back before it releases', async () => {
      const order: string[] = [];
      queryRunner.rollbackTransaction.mockImplementation(async () => void order.push('rollback'));
      queryRunner.release.mockImplementation(async () => void order.push('release'));

      await expect(
        runInTransaction(dataSource, async () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');

      expect(order).toEqual(['rollback', 'release']);
    });

    it('skips the rollback when no transaction is active, but still releases', async () => {
      queryRunner.isTransactionActive = false;

      await expect(
        runInTransaction(dataSource, async () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');

      expect(queryRunner.rollbackTransaction).not.toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalledTimes(1);
    });

    it('rethrows the original error even when the rollback itself fails', async () => {
      const cause = new Error('the actual problem');
      queryRunner.rollbackTransaction.mockRejectedValue(new Error('connection already gone'));

      await expect(
        runInTransaction(dataSource, async () => {
          throw cause;
        }),
      ).rejects.toBe(cause);

      expect(queryRunner.release).toHaveBeenCalledTimes(1);
      expect(Logger.prototype.error).toHaveBeenCalledWith(
        expect.stringContaining('connection already gone'),
      );
    });

    it('logs the rollback with the supplied label', async () => {
      await expect(
        runInTransaction(
          dataSource,
          async () => {
            throw new Error('boom');
          },
          { label: 'quota.consume' },
        ),
      ).rejects.toThrow('boom');

      expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('quota.consume'));
    });

    it('propagates a non-Error throw unchanged', async () => {
      await expect(
        runInTransaction(dataSource, async () => {
          throw 'string failure';
        }),
      ).rejects.toBe('string failure');

      expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(queryRunner.release).toHaveBeenCalledTimes(1);
    });
  });

  describe('when commit fails', () => {
    it('rolls back and releases', async () => {
      queryRunner.commitTransaction.mockRejectedValue(new Error('serialization failure'));

      await expect(runInTransaction(dataSource, async () => 'value')).rejects.toThrow(
        'serialization failure',
      );

      expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(queryRunner.release).toHaveBeenCalledTimes(1);
    });
  });
});

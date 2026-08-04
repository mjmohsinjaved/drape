import { Injectable, Logger } from '@nestjs/common';

import { DatabaseConnectionService } from '@library/database';
import { StorageService } from '@library/storage';

import type {
  DependencyCheckDto,
  LivenessResponseDto,
  ReadinessResponseDto,
} from '../dto/health-response.dto';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  /**
   * Set by npm when the process is started through a package script. Falls back to a
   * literal so the field is always present; it is a build marker, not configuration.
   */
  private readonly version = process.env.npm_package_version ?? '1.0.0';

  constructor(
    private readonly database: DatabaseConnectionService,
    private readonly storage: StorageService,
  ) {}

  /** Liveness: the process is up and answering. No dependency is touched. */
  liveness(): LivenessResponseDto {
    return {
      status: 'ok',
      version: this.version,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Readiness: PostgreSQL answers a round trip, and the storage root is reachable
   * with headroom above `STORAGE_MIN_FREE_MB` (§3.2 requirement 10, E-14).
   *
   * Both probes report `up` or `down` and a latency, and nothing else. Free byte
   * counts, host names, the storage root and the driver in use are **operator**
   * facts: they go to the log line and to `GET /admin/metrics` (ADMIN), never to an
   * anonymous readiness response.
   */
  async readiness(): Promise<ReadinessResponseDto> {
    const [database, storage] = await Promise.all([
      this.probe('database', () => this.database.isHealthy()),
      this.probe('storage', async () => (await this.storage.freeSpace()).ok),
    ]);

    const status = database.status === 'up' && storage.status === 'up' ? 'ok' : 'degraded';

    return {
      status,
      version: this.version,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      database,
      storage,
    };
  }

  private async probe(name: string, check: () => Promise<boolean>): Promise<DependencyCheckDto> {
    const startedAt = Date.now();
    try {
      const healthy = await check();
      if (!healthy) {
        this.logger.warn(`Readiness probe "${name}" reported unhealthy`);
      }
      return { status: healthy ? 'up' : 'down', latencyMs: Date.now() - startedAt };
    } catch (error) {
      // The reason is logged, never returned — a probe response must not describe
      // infrastructure to an anonymous caller.
      this.logger.warn(
        `Readiness probe "${name}" failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return { status: 'down', latencyMs: Date.now() - startedAt };
    }
  }
}

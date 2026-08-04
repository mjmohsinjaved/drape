import { Global, Module, type DynamicModule, type Provider } from '@nestjs/common';

import { METRICS_SINK, type MetricsSink } from './metrics-sink.interface';
import { InProcessMetricsSink, MetricsService } from './metrics.service';

/**
 * Global metrics module — PRD E-13.
 *
 * `@Global()` so `MetricsService` is injectable from every feature module without
 * each one re-importing it: metrics are cross-cutting, exactly like the logger.
 *
 * The sink is bound here and nowhere else. Adding the Prometheus exporter later
 * means `MetricsModule.forRoot({ sink: new PrometheusMetricsSink() })` in
 * `api.module.ts` — no other file changes.
 */
@Global()
@Module({
  providers: [
    { provide: METRICS_SINK, useFactory: (): MetricsSink => new InProcessMetricsSink() },
    MetricsService,
  ],
  exports: [MetricsService, METRICS_SINK],
})
export class MetricsModule {
  /** Binds a custom sink — a Prometheus exporter, or a recording sink in tests. */
  static forRoot(options: { sink?: MetricsSink } = {}): DynamicModule {
    const sinkProvider: Provider =
      options.sink === undefined
        ? { provide: METRICS_SINK, useFactory: (): MetricsSink => new InProcessMetricsSink() }
        : { provide: METRICS_SINK, useValue: options.sink };

    return {
      module: MetricsModule,
      global: true,
      providers: [sinkProvider, MetricsService],
      exports: [MetricsService, METRICS_SINK],
    };
  }
}

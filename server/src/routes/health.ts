import type { FastifyInstance } from 'fastify';
import { SERVICE_NAME, SERVICE_VERSION, type HealthResponse } from '@finally/shared';

const startedAt = Date.now();

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async (): Promise<HealthResponse> => {
    return {
      ok: true,
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      uptimeMs: Date.now() - startedAt,
      ts: Date.now(),
    };
  });
}

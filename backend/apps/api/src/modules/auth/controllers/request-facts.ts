import type { RequestFacts } from '../services/auth.service';

/** The slice of the Express request an auth controller reads. Nothing authorising. */
export interface AuthRequest {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string | undefined>;
}

/**
 * Request facts, taken from Express and never from the payload (S-3).
 *
 * `request.ip` honours `TRUST_PROXY`, which `main.ts` configures — so the address
 * recorded in `auth_attempts` and `sessions` is the client's, not the proxy's.
 *
 * Shared by every controller this module owns, including the one mounted under
 * `/invites`, so there is exactly one definition of what an authenticated request's
 * recorded facts are.
 */
export function requestFacts(request: AuthRequest): RequestFacts {
  const userAgent = request.headers['user-agent'];
  const single = Array.isArray(userAgent) ? userAgent[0] : userAgent;

  return {
    ip: request.ip ?? '0.0.0.0',
    userAgent: typeof single === 'string' && single.length > 0 ? single.slice(0, 512) : null,
  };
}

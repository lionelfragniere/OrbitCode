/* OrbitCode — Authentication Middleware (Phase 5)
 * Pluggable auth layer — supports:
 * 1. None (development/local)
 * 2. GCP IAP (Identity-Aware Proxy)
 * 3. OAuth2 / OIDC
 * 
 * Currently configured for local development (no auth).
 * To enable IAP, set AUTH_MODE=iap and deploy behind Cloud IAP.
 */

import { NextRequest, NextResponse } from 'next/server';

export interface UserSession {
  userId: string;
  email: string;
  name: string;
  avatarUrl?: string;
  provider: 'local' | 'iap' | 'oauth';
  roles: string[];
  authenticatedAt: number;
}

type AuthMode = 'none' | 'iap' | 'oauth';

const AUTH_MODE: AuthMode = (process.env.AUTH_MODE as AuthMode) || 'none';

/** Extract user session from request headers */
export function getUserSession(req: NextRequest): UserSession {
  switch (AUTH_MODE) {
    case 'iap':
      return getIAPSession(req);
    case 'oauth':
      return getOAuthSession(req);
    default:
      return getLocalSession();
  }
}

/** Local development — no auth */
function getLocalSession(): UserSession {
  return {
    userId: 'local-dev',
    email: process.env.USER_EMAIL || 'developer@local',
    name: process.env.USER_NAME || 'Developer',
    provider: 'local',
    roles: ['admin', 'developer'],
    authenticatedAt: Date.now(),
  };
}

/** GCP IAP — extract from X-Goog-Authenticated-User headers */
function getIAPSession(req: NextRequest): UserSession {
  const email = req.headers.get('x-goog-authenticated-user-email')?.replace('accounts.google.com:', '') || '';
  const id = req.headers.get('x-goog-authenticated-user-id')?.replace('accounts.google.com:', '') || '';
  
  if (!email) {
    // Not behind IAP — reject
    throw new AuthError('Not authenticated via IAP');
  }

  return {
    userId: id || email,
    email,
    name: email.split('@')[0] || 'User',
    provider: 'iap',
    roles: ['developer'],
    authenticatedAt: Date.now(),
  };
}

/** OAuth — extract from Authorization header or session cookie */
function getOAuthSession(req: NextRequest): UserSession {
  const authHeader = req.headers.get('authorization');
  const sessionCookie = req.cookies.get('orbitcode_session')?.value;

  if (!authHeader && !sessionCookie) {
    throw new AuthError('Not authenticated');
  }

  // In production, verify JWT token here
  // For now, return a placeholder
  return {
    userId: 'oauth-user',
    email: 'user@corp.com',
    name: 'OAuth User',
    provider: 'oauth',
    roles: ['developer'],
    authenticatedAt: Date.now(),
  };
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

/** Middleware wrapper for protected API routes */
export function withAuth(
  handler: (req: NextRequest, session: UserSession) => Promise<NextResponse>,
  requiredRoles?: string[]
) {
  return async (req: NextRequest) => {
    try {
      const session = getUserSession(req);
      
      // Role check
      if (requiredRoles && requiredRoles.length > 0) {
        const hasRole = requiredRoles.some((r) => session.roles.includes(r));
        if (!hasRole) {
          return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
        }
      }

      return handler(req, session);
    } catch (err) {
      if (err instanceof AuthError) {
        return NextResponse.json({ error: err.message }, { status: 401 });
      }
      throw err;
    }
  };
}

/** API route to get current user info */
export async function getCurrentUser(req: NextRequest): Promise<NextResponse> {
  try {
    const session = getUserSession(req);
    return NextResponse.json(session);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Not authenticated', authMode: AUTH_MODE }, { status: 401 });
    }
    return NextResponse.json({ error: 'Auth error' }, { status: 500 });
  }
}

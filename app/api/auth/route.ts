/* OrbitCode — Auth API
 * GET: Get current user session
 */

import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth';

export async function GET(req: NextRequest) {
  return getCurrentUser(req);
}

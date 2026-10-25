import { authenticateStudent } from '@/lib/server/auth';

export async function POST(request: Request): Promise<Response> {
  return authenticateStudent(request);
}

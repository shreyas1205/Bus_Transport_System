import { PrismaClient } from '@prisma/client';

import { assertDemoDatabase } from './demoMode.js';

assertDemoDatabase(process.env.DATABASE_URL);

export const prisma = new PrismaClient();

// Approves ONLY the Demo Parent -> Demo Student link for live tracking by adding it to
// VERIFIED_GUARDIAN_LINKS in backend/.env (existing approvals are kept). Restart the backend after.
//   node scripts/approve-demo-guardian.mjs
import 'dotenv/config';
import fs from 'node:fs';
import { prisma } from '../src/prisma.js';

const parent = await prisma.user.findUnique({ where: { email: 'parent@naviguard.demo' } });
const student = await prisma.user.findUnique({ where: { email: 'student@naviguard.demo' } });
if (!parent || !student) { console.log('Run node scripts/add-demo-accounts.mjs first.'); process.exit(1); }
const envPath = new URL('../.env', import.meta.url);
const env = fs.readFileSync(envPath, 'utf8');
const match = env.match(/^VERIFIED_GUARDIAN_LINKS=(.*)$/m);
let links = [];
try { links = JSON.parse((match?.[1] || '[]').trim().replace(/^['"]|['"]$/g, '')); } catch { links = []; }
if (links.some(l => l.parentId === parent.id && l.studentId === student.id)) console.log('Already approved.');
else {
  links.push({ parentId: parent.id, studentId: student.id });
  const line = `VERIFIED_GUARDIAN_LINKS='${JSON.stringify(links)}'`;
  fs.writeFileSync(envPath, match ? env.replace(/^VERIFIED_GUARDIAN_LINKS=.*$/m, line) : env.replace(/\s*$/, '\n') + line + '\n');
  console.log(`Approved Demo Parent -> Demo Student (${links.length} approved link(s) in total).`);
}
console.log('Restart the backend (Ctrl+C, then npm run dev) for this to take effect.');
await prisma.$disconnect();

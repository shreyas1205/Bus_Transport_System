// Generates a PostgreSQL baseline migration from schema.prisma and marks it
// applied on the current database (which was created with `prisma db push`).
// Safe: no data is changed; it only writes SQL and a _prisma_migrations row.
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const dir = 'prisma/migrations/0_init';
if (fs.existsSync(dir)) {
  console.log(`${dir} already exists; nothing to do.`);
  process.exit(0);
}
fs.mkdirSync(dir, { recursive: true });
const sql = execSync(
  'npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script',
  { encoding: 'utf8' }
);
fs.writeFileSync(`${dir}/migration.sql`, sql);
fs.writeFileSync('prisma/migrations/migration_lock.toml', 'provider = "postgresql"\n');
console.log(`Wrote ${dir}/migration.sql`);
if (process.argv.includes('--mark-applied')) {
  execSync('npx prisma migrate resolve --applied 0_init', { stdio: 'inherit' });
}
console.log('Fresh database: npx prisma migrate deploy. Existing db-push database: rerun with --mark-applied.');

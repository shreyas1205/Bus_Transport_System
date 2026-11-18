# Legacy SQLite migration (not used)

`20261002_fee_payment_upgrade` was written for SQLite (`DATETIME`, TEXT enums).
`schema.prisma` targets PostgreSQL, so it was moved out of `prisma/migrations`
to stop `prisma migrate deploy` from failing. The project keeps its existing
`npx prisma db push` workflow; to start tracked migrations instead, run
`npm run db:baseline` (see backend/package.json).

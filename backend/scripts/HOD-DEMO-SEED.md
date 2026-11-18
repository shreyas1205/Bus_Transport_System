# HOD demo seed

Prepared only; the seed has not been executed. No database access is needed to
check JavaScript or PowerShell syntax.

When execution is authorized, run from the project root:

```powershell
& .\backend\scripts\run-hod-demo-seed.ps1
```

The runner prompts for PostgreSQL credentials with a hidden password prompt.
It constructs only `localhost:5432/naviguard_hod_demo_20261020`; there is no
database/host override. The seed pins localhost to IPv4 loopback and checks the
server's database, address and port. It never writes `backend/.env` and supplies
the target connection explicitly rather than using that file's database URL.
Do not use `npm run seed`: the old seed deletes existing records.

The new seed refuses populated tables, unexpected application tables/schemas,
custom triggers, a stale generated Prisma schema, insecure credential ACLs or an
unexpected target. All inserts and the initial checks share a serializable
transaction with locks on every application table. No automatic retry, upsert,
delete, reset or migration is performed. A second successful invocation is
intentionally refused because the database is no longer empty.

Fixture contents: five users (one of each role), four role profiles, one active
vehicle, one active route, two stops and two ordered RouteStop rows. All other
models remain empty. The student's direct route/pickup fields are sufficient for
the current transport selection fallback, so no fee, enrollment, payment or pass
is fabricated. The driver is assigned through Route.assignedDriverId; its
synthetic license remains PENDING because permanent assignment does not require
license verification. This fixture does not claim eligibility for temporary
driver assignment or paid boarding.

## Guardian approval

ParentProfile.userId is the real parent relation; studentId is a scalar canonical
student user ID, not a Prisma student relation. The production phone
reconciliation function creates that link from unique matching synthetic contacts.
The synthetic phone is never contacted and is not claimed to be a reserved number.

The operator-provisioned test approval is an exact parent/student pair in
VERIFIED_GUARDIAN_LINKS. This represents approval of known synthetic fixtures,
not a claim of real-world OTP or identity verification. Production code and checks
are unchanged. The actual verifiedParentStudent function is tested against the
database with missing, mismatched and correct approvals, including a non-parent
ID, before commit and again in a read-only transaction after commit.

Approval is runtime configuration, not a database verification flag. For a later
**separately configured demo backend process targeting this same demo database**,
load the saved approval into that process environment before starting the server:

```powershell
# Use the exact private path reported by the runner. Do not print the parsed file.
$fixture = Get-Content -LiteralPath '<private credentials.json path>' -Raw | ConvertFrom-Json
if ($fixture.status -ne 'COMMITTED_AND_READ_ONLY_VERIFIED') { throw 'Unverified seed outcome' }
$env:VERIFIED_GUARDIAN_LINKS = $fixture.VERIFIED_GUARDIAN_LINKS
$fixture = $null
```

The seed does not start or reconfigure a running backend. Without that demo-process
approval, parent transport endpoints correctly return 403. Never apply the
fixture approval to the original database or production process.

## Credentials and failure handling

Five distinct passwords use crypto.randomBytes(24) and the existing scrypt
password helper. The only password output is
`%LOCALAPPDATA%\NaviGuard\HodDemo\<random-run-id>\credentials.json`.
Its directory and file have inheritance disabled and a single current-user SID
FullControl grant; ACLs, ownership and absence of reparse points are checked
before secrets are written. The file contains plaintext test credentials, so keep
it private. It contains no database password.

Credentials are flushed to disk before commit with PREPARED_NOT_CONFIRMED status.
COMMITTED_AND_READ_ONLY_VERIFIED is saved only after post-commit checks pass.
If interrupted or failed, retain the file; PREPARED does not establish whether
commit happened. Investigate using read-only checks rather than resetting or
rerunning blindly. A failure before writing can leave an empty private file.

No server, route handlers, notification services, payment clients, emergency
services or schedulers are started. Provider secrets are removed from the seed
child process, autonomous dispatch is disabled, and HTTP/HTTPS/fetch entry points
are blocked. The database engine connects only to the pinned loopback target.
These controls apply to seeding; they do not configure external services for a
later interactive demo server.

Validation performed while preparing: JavaScript syntax, PowerShell parser,
generated-schema comparison ignoring whitespace, and existing in-memory transport
and guardian authorization tests. Live database/ACL execution remains deliberately
unperformed until the runner is authorized.

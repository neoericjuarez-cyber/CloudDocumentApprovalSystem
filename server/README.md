# CloudDocs API (server)

Express + TypeScript + PostgreSQL. Requires Node 20+ and PostgreSQL 14+.

## First-time setup

1. Create the database (use the password you set when installing PostgreSQL):
   ```
   psql -U postgres -c "CREATE DATABASE clouddocs;"
   ```
   (No `psql` on your PATH? Open "SQL Shell (psql)" from the Start menu, or create `clouddocs` in pgAdmin.)
2. Configure the environment:
   ```
   cd server
   copy .env.example .env      # macOS/Linux: cp .env.example .env
   ```
   Then edit `.env`:
   - put your real PostgreSQL password in `DATABASE_URL`
   - set `JWT_SECRET` to a long random string. Generate one with:
     `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
     (If you set up `.env` on day one, just add this line. The server won't start without it.)
3. Install, create the tables, add demo data, start:
   ```
   npm install
   npm run db:migrate
   npm run db:seed
   npm run dev
   ```
4. Open http://localhost:4000/api/health. You should see `{"status":"ok","db":"up"}`.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the API with auto-reload |
| `npm run db:migrate` | Apply any new files in `db/migrations/` (safe to re-run) |
| `npm run db:seed` | DEV ONLY: wipe tables and insert demo users + a sample request |
| `npm run db:reset` | DEV ONLY: drop everything, re-migrate (then run `db:seed`) |
| `npm test` | Run the API tests (needs a migrated + seeded database; creates and cleans up its own requests) |
| `npm run typecheck` | Type-check without running |

Demo logins (password `password123` for all): `andrea.santos@g.msuiit.edu.ph` and `miguel.ramos@g.msuiit.edu.ph` (students),
`ramon.flores@msuiit.edu.ph` (Adviser), `maria.reyes@msuiit.edu.ph` (Chairperson),
`jose.villanueva@msuiit.edu.ph` (College Dean). The approver names are placeholders.

## Authentication

Sign in with `POST /api/auth/login`, then send the returned token on every later request as
`Authorization: Bearer <token>`.

| Endpoint | Auth | Description |
| --- | --- | --- |
| `POST /api/auth/login` | none | Body `{ email, password }`. Returns `{ token, user }`. 401 on bad credentials, 400 on bad input, 429 after 10 failed attempts in 15 min per IP |
| `GET /api/auth/me` | token | Returns `{ user }` for the token's owner |

`user` is `{ id, name, email, role, position, studentNo, college, department }`.

Protecting a future route:
```ts
router.get("/queue", requireAuth, requireRole("approver"), handler);   // 401 if not signed in, 403 if wrong role
```
Inside the handler, the signed-in user is `req.user`.

## Requests and approvals

All endpoints need `Authorization: Bearer <token>`. Requests are addressed by reference number (`IIT-2025-1048`).

| Endpoint | Who | Description |
| --- | --- | --- |
| `GET /api/requests` | any | Students: their own requests. Approvers: requests whose chain has reached their position (status shown is the status of *their* step) |
| `GET /api/requests/:ref` | any | One request with its steps and history. `404` if it isn't yours to see |
| `POST /api/requests` | student | Body `{ type, data }`. Creates the request and its Adviser → Chairperson → College Dean steps |
| `PUT /api/requests/:ref` | student | Body `{ data }`. Edit and resubmit a request that was returned for revision (the chain starts over) |
| `POST /api/requests/:ref/approve` | approver | Body `{ comment? }`. Only the position whose turn it is can act; moves it to the next signer, or completes it |
| `POST /api/requests/:ref/return` | approver | Body `{ reason }`. Returns it to the student for changes |
| `POST /api/requests/:ref/reject` | approver | Body `{ reason }`. Ends the request |
| `GET /api/requests/:ref/pdf` | student (own), approvers in the chain | The official PDF with the signatures embedded. `409` until all three approvals are in |
| `GET /api/notifications` | any | `{ notifications, unreadCount }` |
| `POST /api/notifications/read-all` | any | Marks all of your notifications read |
| `POST /api/notifications/:id/read` | any | Marks one read |

Types: `Load Revision Form`, `Leave of Absence Form`, `Shifter's Application Form`. Every status change happens in a single
database transaction with the request locked, so two people (or a double-click) can never act on the same step twice.

## E-signatures

Approvers have one saved signature each (a small PNG). Approving **requires** one, and a copy is stamped onto the document at that
moment, so changing your signature later never alters documents you already signed.

| Endpoint | Who | Description |
| --- | --- | --- |
| `GET /api/signature` | approver | Your saved signature, or `{ signature: null }` |
| `PUT /api/signature` | approver | Body `{ imageData }`: a `data:image/png;base64,...` URL. Only genuine PNGs up to 150 KB and 1200×600 are accepted (the bytes are checked, not just the label, so SVG/JPEG/script files are refused) |
| `DELETE /api/signature` | approver | Removes it (you can't approve until you save a new one) |

## SQL injection protection

Three layers, all tested:

1. **Parameterized queries everywhere.** Values always travel as `$1, $2...` parameters, never pasted into SQL text.
2. **A guard test** (`test/sql-safety.test.ts`) reads all the source code and fails if any database call builds SQL text from a variable.
   It also proves it can catch the mistake by checking known-bad snippets.
3. **Live attacks** (`test/security.test.ts`) throw classic payloads at the running API (login fields, URLs, form text, comments)
   and verify nothing got in and no table, password or request changed.

Optional fourth layer: run the API with a **restricted database login** that can only read and write rows, so even a hypothetical flaw
couldn't drop or alter tables. See `db/least_privilege.sql` (instructions inside). The whole test suite passes under that login.

## Demo data (dev only)

`npm run db:seed` wipes the tables and creates 4 students, the 3 approvers (each with a saved signature) and **12 sample requests**
covering all three forms in every state: pending at each stage, completed, returned for revision and rejected.
All demo accounts use the password `password123`:

| Account | Role |
| --- | --- |
| `andrea.santos@g.msuiit.edu.ph`, `miguel.ramos@g.msuiit.edu.ph`, `patricia.cruz@g.msuiit.edu.ph`, `joel.dizon@g.msuiit.edu.ph` | students |
| `ramon.flores@msuiit.edu.ph` | Adviser |
| `maria.reyes@msuiit.edu.ph` | Chairperson |
| `jose.villanueva@msuiit.edu.ph` | College Dean |

## Changing the database

Never edit `001_init.sql` after it has been shared. Add a new file instead
(`002_add_attachments.sql`, ...) and run `npm run db:migrate`.

## Layout

```
db/migrations/   SQL schema, applied in filename order
src/config/      environment validation
src/lib/         db pool + transactions, approval-chain definition (workflow.ts), jwt, errors
src/middleware/  requireAuth / requireRole, body validation, error handler
src/modules/     one folder per feature (auth, requests, notifications, signatures): routes + service
test/            API tests (npm test)
src/db/          migrate / seed / reset scripts
src/app.ts       Express app (routers get mounted here)
src/server.ts    entry point
```

# Wollo Info Hub — Backend v2 (Supabase)

Express API backed by Supabase (Postgres + Auth + RLS + Storage).  
Replaces the old MAMP MySQL stack while keeping all existing API endpoints working.

---

## Quick Start

```bash
# 1. Install deps
npm install

# 2. Copy env and fill in your values
cp .env.example .env

# 3. Run migrations in the Supabase SQL editor (in order):
#    supabase/migrations/0001_extensions_and_enums.sql
#    supabase/migrations/0002_core_tables.sql
#    supabase/migrations/0003_indexes.sql
#    supabase/migrations/0004_helper_functions.sql
#    supabase/migrations/0005_triggers.sql
#    supabase/migrations/0006_views.sql
#    supabase/migrations/0007_rls_policies.sql
#    supabase/migrations/0008_rpc_functions.sql
#    supabase/migrations/0009_storage.sql
#    supabase/seed.sql

# 4. Start the server
npm run dev
```

---

## Environment Variables

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Your project URL (from Dashboard → Settings → API) |
| `SUPABASE_ANON_KEY` | Public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret service-role key — server only, never expose to browser |
| `SUPABASE_JWT_SECRET` | JWT secret for verifying tokens server-side |
| `PORT` | Express port (default 5000) |
| `CORS_ORIGIN` | Comma-separated allowed origins |

---

## API Endpoints

### Auth  `/api/auth`
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/register` | — | Register new user |
| POST | `/login` | — | Login, returns Supabase session |
| GET | `/me` | Bearer | Current user profile |
| POST | `/logout` | Bearer | Invalidate session |
| POST | `/refresh` | — | Refresh access token |

### Admin  `/api/admin`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/users` | admin | List all users (from v_admin_users, no duplicates) |
| PUT | `/users/:id` | admin | Update user name/username |
| PATCH | `/users/:id/password` | admin | Reset user password |
| PATCH | `/users/:id/role` | admin | Change user role |
| DELETE | `/users/:id` | admin | Delete user |
| GET | `/staff` | admin | List staff + heads |
| POST | `/staff` | admin | Create staff/head account |
| DELETE | `/staff/:id` | admin | Remove staff |
| GET | `/faculties` | admin | Faculties + departments |
| POST | `/faculties` | admin | Create faculty |
| PUT | `/faculties/:id` | admin | Update faculty |
| DELETE | `/faculties/:id` | admin | Delete faculty |
| GET | `/faculties/:id/departments` | admin | Departments in faculty |
| POST | `/faculties/:id/departments` | admin | Add department |
| PUT | `/departments/:id` | admin | Update department |
| DELETE | `/departments/:id` | admin | Delete department |
| GET | `/audit` | admin | Audit log |

### Departments  `/api/departments`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/:id/reviews` | — | Reviews for department |
| POST | `/:id/reviews` | Bearer | Post a review |

### Content  `/api/content`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | admin | List content items |
| GET | `/:id` | admin | Get single item |
| POST | `/` | admin | Create item |
| PUT | `/:id` | admin | Update item |
| PATCH | `/:id/publish` | admin | Publish |
| PATCH | `/:id/unpublish` | admin | Unpublish |
| DELETE | `/:id` | admin | Delete |

### Motivations  `/api/motivations`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | Bearer | List motivations |
| POST | `/` | admin/head | Create |
| PUT | `/:id` | admin/head | Update |
| DELETE | `/:id` | admin/head | Delete |

### Opportunities  `/api/opportunities`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | Bearer | List opportunities |
| POST | `/` | admin/head | Create |
| PUT | `/:id` | admin/head | Update |
| DELETE | `/:id` | admin/head | Delete |

### Media  `/api/media`
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/upload` | admin/head | Upload files to Supabase Storage |
| GET | `/` | admin | List media |
| DELETE | `/:id` | admin | Delete media |

### Public  `/api/public`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/sections/:slug` | — | Published content by section |
| GET | `/faculties` | — | All faculties + departments |
| GET | `/motivations` | — | Published motivations |
| GET | `/opportunities` | — | Published opportunities |

### Students  `/api/students`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/profile` | student | Own profile |
| PATCH | `/department` | student | Choose/change department |
| GET | `/library` | student | Personal library |
| POST | `/library` | student | Add document to library |
| DELETE | `/library/:docId` | student | Remove from library |

### Audit  `/api/audit`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | admin | Full audit log |
| GET | `/department/:id` | head | Department audit log |

---

## Testing Each Role

### Admin
1. Create a user via `/api/auth/register`
2. Run `node src/scripts/makeAdmin.js <email>` to promote them
3. Login → get access_token → use as `Authorization: Bearer <token>`
4. `GET /api/admin/users` should return all users with no duplicates

### Department Head
1. Admin creates head: `POST /api/admin/staff` `{ role: "head", department_id: "...", email, password }`
2. Head logs in via `/api/auth/login`
3. `GET /api/departments/:id/reviews` — sees only their department
4. `POST /api/motivations` — creates motivation scoped to their department

### Student
1. Register via `/api/auth/register`
2. `PATCH /api/students/department` `{ department_id: "..." }` — choose department
3. `GET /api/students/library` — empty personal library
4. `POST /api/students/library` `{ document_id: "..." }` — add document

### Anonymous
1. `GET /api/public/faculties` — should list faculties + departments ✓
2. `GET /api/public/sections/motivation` — should list published motivations ✓
3. `GET /api/admin/users` — should return 401 ✓
4. `GET /api/content` — should return 401 ✓

---

## RLS Test Checklist

- [ ] **admin sees all**: `GET /api/admin/users` returns users from all roles
- [ ] **head sees only own department**: head JWT on `GET /api/opportunities` returns only their dept's items
- [ ] **student cannot see other students**: `GET /api/students/profile` for user A returns only user A's data; calling with user B's token returns user B's data
- [ ] **anon sees only public data**: unauthenticated `GET /api/public/faculties` works; `GET /api/admin/users` returns 401
- [ ] **audit logs append-only**: no UPDATE or DELETE on audit_logs succeeds even for admin via SQL
- [ ] **head cannot change roles**: `PATCH /api/admin/users/:id/role` with head JWT returns 403
- [ ] **one active head per department**: assigning a second head to same dept raises unique violation

---

## Promoting a User to Admin

```bash
node src/scripts/makeAdmin.js user@example.com
```

---

## One-Time MySQL Migration

```bash
# Ensure old MySQL is running and MYSQL_* vars are set in .env
node src/scripts/migrateFromMysql.js
```

/**
 * src/config/supabase.js
 *
 * Supabase clients using @supabase/supabase-js if installed,
 * otherwise falls back to a lightweight fetch-based client
 * so the server starts even before npm install is run.
 *
 * TLS fix: Node 24 on Windows doesn't trust the Supabase CA by default.
 * We set NODE_TLS_REJECT_UNAUTHORIZED=0 as an emergency fallback when
 * running in development. Start the server with --use-system-ca for the
 * proper fix (already set in package.json scripts).
 */

'use strict';

require('dotenv').config();

// ── TLS fix for Node 24 on Windows ───────────────────────────
// The proper fix is --use-system-ca (set in package.json).
// This env var is a safety net for any direct `node src/server.js` calls.
if (process.env.NODE_ENV !== 'production') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

const {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

if (!SUPABASE_URL)              throw new Error('Missing SUPABASE_URL in .env');
if (!SUPABASE_ANON_KEY)         throw new Error('Missing SUPABASE_ANON_KEY in .env');
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY in .env');

// ── Try to use the official SDK if installed ──────────────────
let createClient;
try {
  ({ createClient } = require('@supabase/supabase-js'));
} catch {
  // SDK not installed — use the fetch-based shim below
  createClient = null;
}

// ── Lightweight fetch-based shim (no extra deps) ──────────────
// Implements only the subset used by our routes:
//   .from(table).select(cols).eq/in/ilike/order/range/limit/maybeSingle/single
//   .insert/update/delete/upsert
//   .auth.getUser / .auth.admin.*  / .storage.*
//   .rpc(fn, args)
function makeFetchClient(apiKey, accessToken) {
  const headers = {
    'apikey':        apiKey,
    'Authorization': `Bearer ${accessToken || apiKey}`,
    'Content-Type':  'application/json',
    'Prefer':        'return=representation',
  };

  // ── PostgREST query builder ───────────────────────────────
  function from(table) {
    let _select   = '*';
    let _filters  = [];
    let _order    = null;
    let _limit    = null;
    let _range    = null;
    let _single   = false;
    let _maySingle= false;
    let _count    = null;

    const builder = {
      select(cols, opts = {}) {
        _select = cols || '*';
        if (opts.count) _count = opts.count;
        return builder;
      },
      eq(col, val)    { _filters.push(`${col}=eq.${encodeURIComponent(val)}`);  return builder; },
      neq(col, val)   { _filters.push(`${col}=neq.${encodeURIComponent(val)}`); return builder; },
      in(col, vals)   { _filters.push(`${col}=in.(${vals.map(v=>encodeURIComponent(v)).join(',')})`); return builder; },
      ilike(col, pat) { _filters.push(`${col}=ilike.${encodeURIComponent(pat)}`); return builder; },
      or(expr)        { _filters.push(`or=(${expr})`);  return builder; },
      gt(col, val)    { _filters.push(`${col}=gt.${encodeURIComponent(val)}`);  return builder; },
      gte(col, val)   { _filters.push(`${col}=gte.${encodeURIComponent(val)}`); return builder; },
      order(col, opts = {}) {
        _order = `${col}.${opts.ascending === false ? 'desc' : 'asc'}`;
        return builder;
      },
      limit(n)        { _limit = n; return builder; },
      range(from, to) { _range = `${from}-${to}`; return builder; },
      single()        { _single = true; return builder; },
      maybeSingle()   { _maySingle = true; return builder; },

      // Execute helpers
      async _run(method, body) {
        let url = `${SUPABASE_URL}/rest/v1/${table}`;
        const params = [];
        if (method === 'GET' || !method) {
          params.push(`select=${encodeURIComponent(_select)}`);
          _filters.forEach(f => params.push(f));
          if (_order) params.push(`order=${_order}`);
          if (_limit !== null) params.push(`limit=${_limit}`);
        } else {
          // for non-GET also include filters as query params
          params.push(`select=${encodeURIComponent(_select)}`);
          _filters.forEach(f => params.push(f));
        }
        if (params.length) url += '?' + params.join('&');

        const h = { ...headers };
        if (_count) h['Prefer'] = 'return=representation,count=exact';
        if (_range) h['Range'] = _range;
        if (_single || _maySingle) h['Accept'] = 'application/vnd.pgrst.object+json';

        const res = await fetch(url, {
          method: method || 'GET',
          headers: h,
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });

        let data = null;
        const text = await res.text();
        try { data = text ? JSON.parse(text) : null; } catch { data = null; }

        if (!res.ok && res.status !== 406) {
          return { data: null, error: { message: data?.message || data?.hint || `HTTP ${res.status}`, code: data?.code }, count: null };
        }
        if (res.status === 406) return { data: null, error: null, count: null }; // maybeSingle not found

        const countHeader = res.headers.get('content-range');
        const count = countHeader ? parseInt(countHeader.split('/')[1]) : null;

        return { data, error: null, count };
      },

      then(resolve, reject) { return builder._run('GET').then(resolve, reject); },
    };

    // Add mutation methods
    builder.insert = (body, opts = {}) => {
      if (opts.onConflict) headers['Prefer'] = `resolution=merge-duplicates,return=representation`;
      return { ...builder, then: (res, rej) => builder._run('POST', body).then(res, rej) };
    };
    builder.upsert = (body, opts = {}) => {
      headers['Prefer'] = `resolution=merge-duplicates,return=representation`;
      return { ...builder, then: (res, rej) => builder._run('POST', body).then(res, rej) };
    };
    builder.update = (body) => ({ ...builder, then: (res, rej) => builder._run('PATCH', body).then(res, rej) });
    builder.delete = ()     => ({ ...builder, then: (res, rej) => builder._run('DELETE').then(res, rej) });

    return builder;
  }

  // ── RPC ───────────────────────────────────────────────────
  async function rpc(fn, args = {}) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method:  'POST',
      headers,
      body:    JSON.stringify(args),
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!res.ok) return { data: null, error: { message: data?.message || `HTTP ${res.status}`, code: data?.code } };
    return { data, error: null };
  }

  // ── Auth (minimal — only what routes use) ─────────────────
  const auth = {
    async getUser(token) {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { ...headers, Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { data: { user: null }, error: { message: data.msg || 'Invalid token' } };
      return { data: { user: data }, error: null };
    },
    async signUp({ email, password, options }) {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
        method: 'POST', headers,
        body: JSON.stringify({ email, password, data: options?.data }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { data: {}, error: { message: data.msg || data.error_description || 'Signup failed' } };
      return { data: { user: data.user || data, session: data.session || null }, error: null };
    },
    async signInWithPassword({ email, password }) {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST', headers,
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { data: {}, error: { message: data.error_description || data.msg || 'Invalid credentials' } };
      return { data: { user: data.user, session: { access_token: data.access_token, refresh_token: data.refresh_token, expires_in: data.expires_in } }, error: null };
    },
    async refreshSession({ refresh_token }) {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST', headers,
        body: JSON.stringify({ refresh_token }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { data: {}, error: { message: data.error_description || 'Refresh failed' } };
      return { data: { session: { access_token: data.access_token, refresh_token: data.refresh_token, expires_in: data.expires_in } }, error: null };
    },
    async signOut() { return { error: null }; },
    admin: {
      async listUsers({ perPage = 1000 } = {}) {
        const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=${perPage}`, { headers });
        const data = await res.json().catch(() => ({ users: [] }));
        if (!res.ok) return { data: { users: [] }, error: { message: data.msg } };
        return { data: { users: data.users || [] }, error: null };
      },
      async createUser({ email, password, email_confirm, user_metadata }) {
        const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
          method: 'POST', headers,
          body: JSON.stringify({ email, password, email_confirm, user_metadata }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return { data: null, error: { message: data.msg || data.message || 'Create failed' } };
        return { data: { user: data }, error: null };
      },
      async updateUserById(id, attrs) {
        const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
          method: 'PUT', headers,
          body: JSON.stringify(attrs),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return { error: { message: data.msg || 'Update failed' } };
        return { data, error: null };
      },
      async deleteUser(id) {
        const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          return { error: { message: data.msg || 'Delete failed' } };
        }
        return { error: null };
      },
    },
  };

  // ── Storage (minimal) ─────────────────────────────────────
  const storage = {
    from(bucket) {
      return {
        async upload(path, buffer, opts = {}) {
          const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
            method:  'POST',
            headers: { ...headers, 'Content-Type': opts.contentType || 'application/octet-stream', 'x-upsert': opts.upsert ? 'true' : 'false' },
            body:    buffer,
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) return { error: { message: data.error || data.message || 'Upload failed' } };
          return { data, error: null };
        },
        async remove(paths) {
          const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}`, {
            method:  'DELETE',
            headers,
            body:    JSON.stringify({ prefixes: paths }),
          });
          return { error: res.ok ? null : { message: 'Delete failed' } };
        },
        getPublicUrl(path) {
          return { data: { publicUrl: `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}` } };
        },
      };
    },
  };

  return { from, rpc, auth, storage };
}

// ── Export clients ────────────────────────────────────────────
let anonClient, adminClient;

if (createClient) {
  // Official SDK path
  const sdkOpts = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
  anonClient   = createClient(SUPABASE_URL, SUPABASE_ANON_KEY,         sdkOpts);
  adminClient  = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, sdkOpts);
} else {
  // Shim path (no SDK installed)
  anonClient  = makeFetchClient(SUPABASE_ANON_KEY);
  adminClient = makeFetchClient(SUPABASE_SERVICE_ROLE_KEY);
  console.warn('[supabase] @supabase/supabase-js not installed — using fetch shim. Run npm install to get the full SDK.');
}

function createUserClient(accessToken) {
  if (createClient) {
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth:   { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
  }
  return makeFetchClient(SUPABASE_ANON_KEY, accessToken);
}

module.exports = { anonClient, adminClient, createUserClient };

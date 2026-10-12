require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const DEPT_NAME = 'Medicine';
const EMAIL     = 'head.medicine@wollo.edu.et';
const PASSWORD  = 'WolloMed2025!';   // change this
const NAME      = 'Dr. Abebe Girma';

(async () => {
  try {
    let { data: dept } = await supabase
      .from('departments').select('id').eq('name', DEPT_NAME).maybeSingle();
    if (!dept) {
      const { data, error } = await supabase
        .from('departments').insert({ name: DEPT_NAME }).select('id').single();
      if (error) throw error;
      dept = data;
    }

    const { data: created, error: authErr } = await supabase.auth.admin.createUser({
      email: EMAIL, password: PASSWORD, email_confirm: true,
      user_metadata: { full_name: NAME },
    });
    if (authErr) throw authErr;

    const { error: profErr } = await supabase.from('staff_profiles').insert({
      user_id: created.user.id, role: 'head', department_id: dept.id,
    });
    if (profErr) throw profErr;

    console.log('✅ Head created:', EMAIL, '→', DEPT_NAME);
  } catch (err) {
    console.error('❌ Failed:', err.message);
    process.exitCode = 1;
  }
})();
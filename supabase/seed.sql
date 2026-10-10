-- ============================================================
-- Seed Data — Wollo Info Hub
-- Run AFTER all migrations.
-- ============================================================

-- ── Faculties ────────────────────────────────────────────────
insert into public.faculties (id, name_en, name_am, slug, color, sort_order)
values
  ('a1000000-0000-0000-0000-000000000001', 'College of Health Sciences',
   'የጤና ሳይንስ ኮሌጅ',          'health',          '#16a34a', 1),
  ('a1000000-0000-0000-0000-000000000002', 'College of Informatics',
   'የኢንፎርማቲክስ ኮሌጅ',         'informatics',     '#2563eb', 2),
  ('a1000000-0000-0000-0000-000000000003', 'College of Engineering',
   'የምህንድስና ኮሌጅ',            'engineering',     '#d97706', 3),
  ('a1000000-0000-0000-0000-000000000004', 'College of Social Sciences & Humanities',
   'የማህበራዊ ሳይንስ ኮሌጅ',       'social-science',  '#7c3aed', 4),
  ('a1000000-0000-0000-0000-000000000005', 'College of Sport Science',
   'የስፖርት ሳይንስ ኮሌጅ',         'sport',           '#db2777', 5)
on conflict (id) do nothing;

-- ── Departments ──────────────────────────────────────────────
insert into public.departments (id, faculty_id, name_en, name_am, slug, description, duration_years)
values
  -- Health
  ('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001',
   'Medicine', 'ህክምና', 'health/medicine',
   'Trains physicians to diagnose and treat human disease.', 6),
  ('b1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001',
   'Pharmacy', 'ፋርማሲ', 'health/pharmacy',
   'Pharmaceutical sciences and clinical practice.', 5),
  ('b1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001',
   'Nursing', 'ነርሲን', 'health/nursing',
   'Patient-centred care and clinical nursing skills.', 4),
  ('b1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001',
   'Midwifery', 'ሚድዋይፈሪ', 'health/midwifery',
   'Maternal and newborn health care.', 4),
  ('b1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000001',
   'Veterinary Medicine', 'የእንስሳት ህክምና', 'health/veterinary',
   'Animal health science and clinical practice.', 5),

  -- Informatics
  ('b1000000-0000-0000-0000-000000000011', 'a1000000-0000-0000-0000-000000000002',
   'Computer Science', 'ኮምፒዩተር ሳይንስ', 'informatics/computer-science',
   'Algorithms, theory of computation, and software.', 4),
  ('b1000000-0000-0000-0000-000000000012', 'a1000000-0000-0000-0000-000000000002',
   'Information Technology', 'ኢንፎርሜሽን ቴክኖሎጂ', 'informatics/it',
   'Applied technology for business and networks.', 4),
  ('b1000000-0000-0000-0000-000000000013', 'a1000000-0000-0000-0000-000000000002',
   'Information Systems', 'ኢንፎርሜሽን ሲስተምስ', 'informatics/information-systems',
   'Database design, ERP, and enterprise systems.', 4),
  ('b1000000-0000-0000-0000-000000000014', 'a1000000-0000-0000-0000-000000000002',
   'Software Engineering', 'ሶፍትዌር ምህንድስና', 'informatics/software-engineering',
   'Software design, testing, and project management.', 4),

  -- Engineering
  ('b1000000-0000-0000-0000-000000000021', 'a1000000-0000-0000-0000-000000000003',
   'Civil Engineering', 'ሲቪል ምህንድስና', 'engineering/civil',
   'Structural, geotechnical, and transportation engineering.', 5),
  ('b1000000-0000-0000-0000-000000000022', 'a1000000-0000-0000-0000-000000000003',
   'Electrical Engineering', 'የኤሌክትሪክ ምህንድስና', 'engineering/electrical',
   'Power systems, electronics, and control.', 5),
  ('b1000000-0000-0000-0000-000000000023', 'a1000000-0000-0000-0000-000000000003',
   'Mechanical Engineering', 'መካኒካል ምህንድስና', 'engineering/mechanical',
   'Thermodynamics, manufacturing, and machine design.', 5),
  ('b1000000-0000-0000-0000-000000000024', 'a1000000-0000-0000-0000-000000000003',
   'Chemical Engineering', 'ኬሚካል ምህንድስና', 'engineering/chemical',
   'Process design, reaction engineering, and materials.', 5),
  ('b1000000-0000-0000-0000-000000000025', 'a1000000-0000-0000-0000-000000000003',
   'Water Resources Engineering', 'የውሃ ሀብት ምህንድስና', 'engineering/water-resources',
   'Hydrology, irrigation, and water supply.', 5),

  -- Social Sciences
  ('b1000000-0000-0000-0000-000000000031', 'a1000000-0000-0000-0000-000000000004',
   'Law', 'ህግ', 'social-science/law',
   'Ethiopian and international law.', 5),
  ('b1000000-0000-0000-0000-000000000032', 'a1000000-0000-0000-0000-000000000004',
   'Accounting & Finance', 'አካውንቲንግ እና ፋይናንስ', 'social-science/accounting',
   'Financial reporting, audit, and corporate finance.', 4),
  ('b1000000-0000-0000-0000-000000000033', 'a1000000-0000-0000-0000-000000000004',
   'Management', 'ማናጅመንት', 'social-science/management',
   'Business strategy, HRM, and organisational behaviour.', 4),
  ('b1000000-0000-0000-0000-000000000034', 'a1000000-0000-0000-0000-000000000004',
   'Journalism & Communication', 'ጋዜጠኝነት', 'social-science/journalism',
   'Media writing, broadcasting, and digital journalism.', 4),
  ('b1000000-0000-0000-0000-000000000035', 'a1000000-0000-0000-0000-000000000004',
   'Economics', 'ኢኮኖሚክስ', 'social-science/economics',
   'Micro/macro-economics, econometrics, and development.', 4),
  ('b1000000-0000-0000-0000-000000000036', 'a1000000-0000-0000-0000-000000000004',
   'Sociology', 'ሶሺዮሎጂ', 'social-science/sociology',
   'Social theory, research methods, and community.', 4),
  ('b1000000-0000-0000-0000-000000000037', 'a1000000-0000-0000-0000-000000000004',
   'Psychology', 'ሳይኮሎጂ', 'social-science/psychology',
   'Developmental, clinical, and industrial psychology.', 4),
  ('b1000000-0000-0000-0000-000000000038', 'a1000000-0000-0000-0000-000000000004',
   'Political Science', 'ፖለቲካ ሳይንስ', 'social-science/political-science',
   'Government, public policy, and international relations.', 4),

  -- Sport
  ('b1000000-0000-0000-0000-000000000041', 'a1000000-0000-0000-0000-000000000005',
   'Sport Science', 'ስፖርት ሳይንስ', 'sport/sport-science',
   'Exercise physiology, coaching, and sports management.', 4)
on conflict (id) do nothing;

-- ── Sample Guide Topics ───────────────────────────────────────
insert into public.guide_topics (problem_key, title_en, title_am, steps)
values
  ('registration_problem',
   'Registration Problem',
   'የምዝገባ ችግር',
   '[
     {"step": 1, "office_number": "Block A - Room 102", "description": "Go to the Registrar Office with your admission letter."},
     {"step": 2, "office_number": "Block A - Room 105", "description": "Submit a signed clearance form."},
     {"step": 3, "office_number": "Finance Office", "description": "Pay fees and get a receipt."},
     {"step": 4, "office_number": "Block A - Room 102", "description": "Return receipt to complete registration."}
   ]'::jsonb),
  ('id_card_problem',
   'ID Card Not Received',
   'የመታወቂያ ካርድ ያልተቀበሉ',
   '[
     {"step": 1, "office_number": "Student Services - Room 201", "description": "Bring your registration receipt and a passport photo."},
     {"step": 2, "office_number": "Student Services - Room 201", "description": "Fill the ID request form."},
     {"step": 3, "office_number": "Student Services - Room 201", "description": "Collect your ID within 3 working days."}
   ]'::jsonb)
on conflict (problem_key) do nothing;

-- ── NOTE: Admin user ─────────────────────────────────────────
-- To create an admin, register a user via the app, then run:
--   node src/scripts/makeAdmin.js <email>
-- OR call the assign_staff RPC after promoting manually in Supabase Dashboard.

/**
 * migrate.js — run once to set up / update the database.
 *   node migrate.js
 *
 * Safe to re-run: every statement uses CREATE TABLE IF NOT EXISTS
 * or addColumnIfMissing / INSERT IGNORE.
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

(async () => {
  const conn = await mysql.createConnection({
    host:               process.env.DB_HOST     || 'localhost',
    port:               Number(process.env.DB_PORT) || 3306,
    user:               process.env.DB_USER     || 'root',
    password:           process.env.DB_PASSWORD || 'root',
    database:           process.env.DB_NAME     || 'wollo-info-hub',
    multipleStatements: true,
  });

  /* ── helper: safe ALTER ── */
  async function addColumnIfMissing(table, column, definition) {
    const [found] = await conn.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column]
    );
    if (!found.length) {
      await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
      console.log(`✓ Added ${column} to ${table}`);
    }
  }

  /* ── helper: safe ADD INDEX ── */
  async function addIndexIfMissing(table, indexName, definition) {
    const [found] = await conn.query(
      `SELECT INDEX_NAME FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
      [table, indexName]
    );
    if (!found.length) {
      await conn.query(`ALTER TABLE \`${table}\` ADD ${definition}`);
      console.log(`✓ Added index ${indexName} on ${table}`);
    }
  }

  try {
    console.log('Connected. Starting migration…\n');

    /* ══════════════════════════════════════
       1. Core user / auth tables
    ══════════════════════════════════════ */
    await conn.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id            INT          NOT NULL AUTO_INCREMENT,
        full_name     VARCHAR(120) NOT NULL,
        email         VARCHAR(180) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        avatar_url    VARCHAR(255)     NULL DEFAULT NULL,
        created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_admins_email (email)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('✓ admins table ready');

    await conn.query(`
      CREATE TABLE IF NOT EXISTS staff (
        id            INT          NOT NULL AUTO_INCREMENT,
        full_name     VARCHAR(120) NOT NULL,
        email         VARCHAR(180) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        avatar_url    VARCHAR(255)     NULL DEFAULT NULL,
        position      VARCHAR(120)     NULL DEFAULT NULL,
        created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_staff_email (email)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('✓ staff table ready');

    await addColumnIfMissing('users', 'avatar_url', 'VARCHAR(255) NULL DEFAULT NULL');
    await addColumnIfMissing('users', 'role',       'VARCHAR(20) NOT NULL DEFAULT \'user\'');

    /* ══════════════════════════════════════
       2. Faculties (NEW)
    ══════════════════════════════════════ */
    await conn.query(`
      CREATE TABLE IF NOT EXISTS faculties (
        id          INT          NOT NULL AUTO_INCREMENT,
        name        VARCHAR(150) NOT NULL,
        slug        VARCHAR(100) NOT NULL,
        color       VARCHAR(20)      NULL DEFAULT '#2563eb',
        image_url   VARCHAR(255)     NULL DEFAULT NULL,
        description TEXT             NULL,
        sort_order  INT          NOT NULL DEFAULT 0,
        created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_faculties_slug (slug)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('✓ faculties table ready');

    /* ══════════════════════════════════════
       3. Departments (extend existing)
    ══════════════════════════════════════ */
    await conn.query(`
      CREATE TABLE IF NOT EXISTS departments (
        id              INT          NOT NULL AUTO_INCREMENT,
        name            VARCHAR(150) NOT NULL,
        description     TEXT             NULL,
        graduates_count INT          NOT NULL DEFAULT 0,
        duration_years  INT          NOT NULL DEFAULT 4,
        PRIMARY KEY (id),
        UNIQUE KEY uq_departments_name (name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    await addColumnIfMissing('departments', 'description',     'TEXT NULL');
    await addColumnIfMissing('departments', 'graduates_count', 'INT NOT NULL DEFAULT 0');
    await addColumnIfMissing('departments', 'duration_years',  'INT NOT NULL DEFAULT 4');
    await addColumnIfMissing('departments', 'slug',            'VARCHAR(100) NULL DEFAULT NULL');
    await addColumnIfMissing('departments', 'faculty_id',      'INT NULL DEFAULT NULL');
    await addColumnIfMissing('departments', 'sort_order',      'INT NOT NULL DEFAULT 0');
    /* FK may not exist yet */
    const [fkRows] = await conn.query(
      `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'departments'
          AND CONSTRAINT_NAME = 'fk_dept_faculty'`
    );
    if (!fkRows.length) {
      await conn.query(
        `ALTER TABLE departments
           ADD CONSTRAINT fk_dept_faculty FOREIGN KEY (faculty_id)
           REFERENCES faculties(id) ON DELETE CASCADE`
      ).catch(() => { /* ignore if faculties doesn't exist yet */ });
    }
    console.log('✓ departments table ready');

    /* ══════════════════════════════════════
       4. Department-head tables
    ══════════════════════════════════════ */
    await conn.query(`
      CREATE TABLE IF NOT EXISTS department_heads (
        id            INT          NOT NULL AUTO_INCREMENT,
        name          VARCHAR(120) NOT NULL,
        email         VARCHAR(160) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        department_id INT          NOT NULL,
        created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_dh_email (email),
        KEY idx_dh_department (department_id),
        CONSTRAINT fk_dh_department
          FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS department_courses (
        id            INT          NOT NULL AUTO_INCREMENT,
        department_id INT          NOT NULL,
        course_name   VARCHAR(200) NOT NULL,
        prerequisites VARCHAR(300) NOT NULL DEFAULT '',
        created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_dc_department (department_id),
        CONSTRAINT fk_dc_department
          FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS department_interests (
        id            INT      NOT NULL AUTO_INCREMENT,
        student_id    INT      NOT NULL,
        department_id INT      NOT NULL,
        created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_di_student_dept (student_id, department_id),
        KEY idx_di_department (department_id),
        CONSTRAINT fk_di_student
          FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_di_department
          FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS department_content (
        id            INT          NOT NULL AUTO_INCREMENT,
        department_id INT          NOT NULL,
        head_id       INT          NOT NULL,
        type          ENUM('opportunity','motivation','document','alumni','staff_profile','graduate') NOT NULL,
        title         VARCHAR(200) NOT NULL,
        body          TEXT             NULL,
        link_url      VARCHAR(500) NOT NULL DEFAULT '',
        status        ENUM('draft','published') NOT NULL DEFAULT 'draft',
        cover_url     VARCHAR(512)     NULL DEFAULT NULL,
        created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_dcont_department (department_id),
        KEY idx_dcont_status     (status),
        CONSTRAINT fk_dcont_department
          FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
        CONSTRAINT fk_dcont_head
          FOREIGN KEY (head_id) REFERENCES department_heads(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    /* Safe alter for old rows that don't have status / cover_url / updated_at */
    await addColumnIfMissing('department_content', 'status',
      "ENUM('draft','published') NOT NULL DEFAULT 'draft'");
    await addColumnIfMissing('department_content', 'cover_url',
      'VARCHAR(512) NULL DEFAULT NULL');
    await addColumnIfMissing('department_content', 'updated_at',
      'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');

    /* ══════════════════════════════════════
       5. Reviews
    ══════════════════════════════════════ */
    await conn.query(`
      CREATE TABLE IF NOT EXISTS department_reviews (
        id            INT          NOT NULL AUTO_INCREMENT,
        department_id VARCHAR(100) NOT NULL,
        name          VARCHAR(120) NOT NULL,
        role          VARCHAR(20)  NOT NULL DEFAULT 'Student',
        rating        TINYINT      NOT NULL,
        comment       TEXT         NOT NULL,
        created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_dr_dept    (department_id),
        KEY idx_dr_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('✓ department_reviews table ready');

    /* ══════════════════════════════════════
       6. Safe ALTER: content_items.department_id
          (so admins and dept heads can tag content)
    ══════════════════════════════════════ */
    await addColumnIfMissing('content_items', 'department_id',
      'INT NULL DEFAULT NULL');
    console.log('✓ content_items.department_id ready');

    /* ══════════════════════════════════════
       7. SEED: faculties
    ══════════════════════════════════════ */
    const FACULTIES = [
      { name: 'College of Health Sciences',      slug: 'medicine',       color: '#e63946', sort_order: 1,
        description: 'Training compassionate health professionals across Ethiopia and beyond.' },
      { name: 'College of Informatics',          slug: 'computer-science', color: '#2563eb', sort_order: 2,
        description: 'Bridging technology and society through rigorous computing education.' },
      { name: 'Institute of Technology',         slug: 'engineering',    color: '#f59e0b', sort_order: 3,
        description: 'Building the infrastructure of tomorrow — roads, bridges, power and water.' },
      { name: 'College of Social Sciences',      slug: 'social-science', color: '#10b981', sort_order: 4,
        description: 'Understanding human societies to address the challenges of a changing world.' },
      { name: 'Sport & Physical Education',      slug: 'sport',          color: '#f97316', sort_order: 5,
        description: 'Developing athletes and physical education professionals.' },
    ];
    for (const f of FACULTIES) {
      await conn.query(
        `INSERT INTO faculties (name, slug, color, description, sort_order)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           name = VALUES(name), color = VALUES(color),
           description = VALUES(description), sort_order = VALUES(sort_order)`,
        [f.name, f.slug, f.color, f.description, f.sort_order]
      );
    }
    console.log('✓ faculties seeded');

    /* ── Fetch faculty IDs for the seeded rows ── */
    const [facRows] = await conn.query('SELECT id, slug FROM faculties');
    const facById = {};
    facRows.forEach(r => { facById[r.slug] = r.id; });

    /* ══════════════════════════════════════
       8. SEED: departments  (INSERT IGNORE so existing rows aren't clobbered)
    ══════════════════════════════════════ */
    const DEPARTMENTS_SEED = [
      /* Health Sciences */
      { faculty: 'medicine',        name: 'Medicine',               slug: 'medicine/md',                     sort: 1 },
      { faculty: 'medicine',        name: 'Pharmacy',               slug: 'medicine/pharmacy',               sort: 2 },
      { faculty: 'medicine',        name: 'Nursing',                slug: 'medicine/nursing',                sort: 3 },
      { faculty: 'medicine',        name: 'Midwifery',              slug: 'medicine/midwifery',              sort: 4 },
      { faculty: 'medicine',        name: 'Veterinary Medicine',    slug: 'medicine/veterinary',             sort: 5 },
      /* Informatics */
      { faculty: 'computer-science', name: 'Computer Science',     slug: 'computer-science/cs',             sort: 1 },
      { faculty: 'computer-science', name: 'Information Technology',slug: 'computer-science/it',            sort: 2 },
      { faculty: 'computer-science', name: 'Information Systems',  slug: 'computer-science/information-systems', sort: 3 },
      { faculty: 'computer-science', name: 'Software Engineering', slug: 'computer-science/software-engineering', sort: 4 },
      /* Engineering */
      { faculty: 'engineering',     name: 'Civil Engineering',      slug: 'engineering/civil',               sort: 1 },
      { faculty: 'engineering',     name: 'Electrical Engineering', slug: 'engineering/electrical',          sort: 2 },
      { faculty: 'engineering',     name: 'Mechanical Engineering', slug: 'engineering/mechanical',          sort: 3 },
      { faculty: 'engineering',     name: 'Chemical Engineering',   slug: 'engineering/chemical',            sort: 4 },
      { faculty: 'engineering',     name: 'Water Resources Engineering', slug: 'engineering/water-resources', sort: 5 },
      /* Social Sciences */
      { faculty: 'social-science',  name: 'Law',                    slug: 'social-science/law',              sort: 1 },
      { faculty: 'social-science',  name: 'Accounting',             slug: 'social-science/accounting',       sort: 2 },
      { faculty: 'social-science',  name: 'Management',             slug: 'social-science/management',       sort: 3 },
      { faculty: 'social-science',  name: 'Journalism',             slug: 'social-science/journalism',       sort: 4 },
      { faculty: 'social-science',  name: 'Economics',              slug: 'social-science/economics',        sort: 5 },
      { faculty: 'social-science',  name: 'Sociology',              slug: 'social-science/sociology',        sort: 6 },
      { faculty: 'social-science',  name: 'Psychology',             slug: 'social-science/psychology',       sort: 7 },
      { faculty: 'social-science',  name: 'Political Science',      slug: 'social-science/political-science', sort: 8 },
      /* Sport */
      { faculty: 'sport',           name: 'Sports Science',         slug: 'sport/sports-science',            sort: 1 },
      { faculty: 'sport',           name: 'Football',               slug: 'sport/football',                  sort: 2 },
      { faculty: 'sport',           name: 'Athletics',              slug: 'sport/athletics',                 sort: 3 },
      { faculty: 'sport',           name: 'Basketball',             slug: 'sport/basketball',                sort: 4 },
      { faculty: 'sport',           name: 'Volleyball',             slug: 'sport/volleyball',                sort: 5 },
      { faculty: 'sport',           name: 'Martial Arts',           slug: 'sport/martial-arts',              sort: 6 },
    ];

    for (const d of DEPARTMENTS_SEED) {
      const facId = facById[d.faculty];
      if (!facId) continue;
      await conn.query(
        `INSERT INTO departments (name, slug, faculty_id, sort_order)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           slug = VALUES(slug), faculty_id = VALUES(faculty_id), sort_order = VALUES(sort_order)`,
        [d.name, d.slug, facId, d.sort]
      );
    }
    console.log('✓ departments seeded');

    /* ══════════════════════════════════════
       Summary
    ══════════════════════════════════════ */
    const [[{ u }]]  = await conn.query('SELECT COUNT(*) AS u  FROM users');
    const [[{ fac }]]= await conn.query('SELECT COUNT(*) AS fac FROM faculties');
    const [[{ dep }]]= await conn.query('SELECT COUNT(*) AS dep FROM departments');
    const [[{ dh }]] = await conn.query('SELECT COUNT(*) AS dh FROM department_heads');
    console.log('\n✅  Migration complete.');
    console.log(`   users           : ${u}`);
    console.log(`   faculties       : ${fac}`);
    console.log(`   departments     : ${dep}`);
    console.log(`   department heads: ${dh}`);
    console.log('\n→ node makeAdmin.js      — promote yourself to admin');
    console.log('→ node makeDepartmentHead.js — create a dept head');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await conn.end();
  }
})();

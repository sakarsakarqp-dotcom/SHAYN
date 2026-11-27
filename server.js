require('dotenv').config();
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const SHAYN_SCHEMA = 'shayn';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${SHAYN_SCHEMA}`, ssl: process.env.DATABASE_SSL === 'false' ? false : (process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined) });
let identitySchemaReady = false;

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: false, limit: '50kb' }));
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use(express.static(path.join(__dirname,'public')));

const TYPES = new Set(['job','project','service','market','business']);

const CATEGORY_NAMES = [
  ['الأزياء والملابس','ملابس نسائية','ملابس رجالية','ملابس أطفال','أحذية','حقائب','إكسسوارات','ساعات','ملابس رياضية','ملابس مناسبات'],
  ['الهواتف والإلكترونيات','هواتف ذكية','أجهزة لوحية','حواسيب محمولة','حواسيب مكتبية','شاشات','سماعات','كاميرات','أجهزة ألعاب','إكسسوارات إلكترونية'],
  ['المنزل والأثاث','أثاث غرف النوم','أثاث غرف الجلوس','مطابخ','أدوات منزلية','ديكور','إنارة','مفروشات','أجهزة منزلية','حدائق'],
  ['الجمال والعناية','عطور','مستحضرات تجميل','العناية بالبشرة','العناية بالشعر','العناية الشخصية','مستلزمات صالونات'],
  ['الأطفال والألعاب','ألعاب أطفال','عربات ومقاعد','ملابس أطفال','مستلزمات الرضع','ألعاب تعليمية'],
  ['الرياضة والرحلات','معدات رياضية','ملابس رياضية','معدات تخييم','دراجات','مستلزمات الرحلات'],
  ['الأغذية والمشروبات','مواد غذائية','منتجات محلية','حلويات ومخبوزات','قهوة وشاي','منتجات زراعية'],
  ['الكتب والقرطاسية','كتب','قرطاسية','مستلزمات مكتبية','أدوات فنية','مستلزمات مدرسية'],
  ['المنتجات الرقمية','قوالب جاهزة','تصاميم رقمية','كتب إلكترونية','ملفات رقمية','برمجيات وتطبيقات','اشتراكات رقمية'],
  ['الصحة والمستلزمات الطبية','مستلزمات طبية عامة','أجهزة قياس','معدات رعاية منزلية','مستلزمات صيدلانية غير دوائية'],
  ['الحيوانات الأليفة','أغذية الحيوانات','مستلزمات القطط','مستلزمات الكلاب','أقفاص وأحواض','إكسسوارات'],
  ['الأدوات والمعدات','أدوات يدوية','معدات كهربائية','معدات ورش','معدات زراعية','أدوات قياس'],
  ['الخدمات','خدمات التوصيل','الصيانة','التصميم','التسويق','التعليم والتدريب','التصوير','الخدمات الرقمية'],
  ['المتاجر والأعمال التجارية','متاجر إلكترونية','متاجر محلية','علامات تجارية','تجار الجملة','موردون','طلبات شراء','شراكات تجارية'],
  ['الهدايا والمناسبات','هدايا','ورود','مستلزمات حفلات','تغليف الهدايا','تحف'],
  ['منتجات يدوية ومحلية','أعمال يدوية','منتجات تراثية','صناعات منزلية','منتجات حرفية'],
  ['أخرى','منتجات متنوعة','عروض خاصة','تصفية مخزون','مستعمل بحالة جيدة']
].map(([name,...children], index) => ({ id:index+1, name, children }));

const safeUser = u => ({ id: u.id, name: u.name, email: u.email, role: u.role, bio: u.bio, created_at: u.created_at });
const asyncRoute = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
async function auth(req,res,next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i,'');
  if (!token) return res.status(401).json({ error: 'يلزم تسجيل الدخول' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const current = await pool.query('SELECT id,email,role FROM users WHERE id=$1 AND is_active=TRUE',[payload.id]);
    if (!current.rowCount) return res.status(401).json({ error: 'الحساب غير موجود أو موقوف' });
    // صلاحيات قاعدة البيانات هي المرجع؛ لا نعتمد على دور قديم محفوظ داخل JWT.
    req.user = current.rows[0];
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError' || error.name === 'NotBeforeError') {
      return res.status(401).json({ error: 'جلسة الدخول غير صالحة، سجل الدخول مجدداً' });
    }
    next(error);
  }
}
function admin(req,res,next) {
  if (!['super_admin','admin','moderator'].includes(req.user.role)) return res.status(403).json({ error: 'لا تملك صلاحية تنفيذ هذا الإجراء' });
  next();
}
function superAdmin(req,res,next) {
  if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'هذه العملية متاحة للمدير الأعلى فقط' });
  next();
}
function identitySchemaRequired(req,res,next) {
  if (!identitySchemaReady) return res.status(503).json({error:'وحدة المؤسسات لم تُهيأ بعد؛ نفّذ ترحيل الهوية ثم أعد تشغيل الخدمة'});
  next();
}
const issueToken = u => jwt.sign({ id: u.id }, JWT_SECRET, { expiresIn: '7d' });

async function initDb() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is missing');
  if (!JWT_SECRET || JWT_SECRET.length < 32 || JWT_SECRET.includes('replace-with')) throw new Error('Set a strong JWT_SECRET (at least 32 characters)');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ADMIN_EMAIL)) throw new Error('Set ADMIN_EMAIL in private environment settings');
  const adminName = String(process.env.ADMIN_NAME || '').trim();
  if (adminName.length < 2 || adminName.length > 120) throw new Error('Set ADMIN_NAME in private environment settings');
  const fs = require('fs');
  // Keep SHAYN isolated from ATHAR's public schema. Legacy public tables
  // are moved only by the explicit db:init command, never silently at boot.
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${SHAYN_SCHEMA}`);
  if (process.argv.includes('--init-db')) {
    await pool.query(fs.readFileSync(path.join(__dirname,'migrations','003_isolate_shayn_schema.sql'),'utf8'));
  } else {
    const state = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM information_schema.tables
          WHERE table_schema='public' AND table_type='BASE TABLE'
          AND table_name IN ('users','listings','applications','messages','reviews','reports')) AS legacy_count,
        (SELECT COUNT(*)::int FROM information_schema.tables
          WHERE table_schema='shayn' AND table_type='BASE TABLE'
          AND table_name IN ('users','listings','applications','messages','reviews','reports')) AS target_count
    `);
    const legacy = state.rows[0].legacy_count;
    const target = state.rows[0].target_count;
    if (legacy > 0 && legacy < 6 && target === 0) {
      throw new Error('Found a partial set of legacy SHAYN tables in public. Refusing to create empty tables; review the database and run the explicit migration safely.');
    }
    if (legacy === 6 && target === 0) {
      throw new Error('Found the six legacy SHAYN tables in public. Run the explicit npm run db:init migration after confirming a backup; startup will not move data automatically.');
    }
  }
  await pool.query(fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8'));
  await pool.query(fs.readFileSync(path.join(__dirname,'migrations','004_commerce_images.sql'),'utf8'));
  await pool.query(fs.readFileSync(path.join(__dirname,'migrations','005_business_ads.sql'),'utf8'));
  await pool.query(fs.readFileSync(path.join(__dirname,'migrations','006_orders.sql'),'utf8'));
  await pool.query(fs.readFileSync(path.join(__dirname,'migrations','002_admin_security.sql'),'utf8'));
  const identityTables = await pool.query(
    "SELECT COUNT(*)::int AS total FROM information_schema.tables " +
    "WHERE table_schema='shayn' AND table_type='BASE TABLE' " +
    "AND table_name = ANY($1::text[])",
    [['user_roles','organizations','organization_memberships','organization_invitations','organization_audit_logs']]
  );
  identitySchemaReady = identityTables.rows[0].total === 5;
  const password = process.env.ADMIN_PASSWORD;
  const existingAdmin = await pool.query('SELECT id FROM users WHERE email=$1',[ADMIN_EMAIL]);
  if (existingAdmin.rowCount) {
    // لا نعيد تعيين كلمة مرور المدير عند كل إعادة تشغيل للخدمة.
    await pool.query(`UPDATE users SET name=$1, role='super_admin', is_active=TRUE, updated_at=NOW() WHERE email=$2`,[adminName,ADMIN_EMAIL]);
  } else {
    if (!password || password.length < 14) throw new Error('ADMIN_PASSWORD must contain at least 14 characters when creating the first administrator account');
    const hash = await bcrypt.hash(password, 12);
    await pool.query(`INSERT INTO users(name,email,password_hash,role,is_active) VALUES($1,$2,$3,'super_admin',TRUE)`,[adminName,ADMIN_EMAIL,hash]);
  }
  console.log('SHAYN database schema and admin-security migration initialized.');
}

app.get('/api/categories', asyncRoute(async (req,res) => {
  const q = await pool.query("SELECT COALESCE(category,'') AS category, type, COUNT(*)::int AS total FROM listings WHERE status='active' GROUP BY category,type");
  const counts = q.rows;
  const categories = CATEGORY_NAMES.map(c => {
    const terms = [c.name, ...c.children].map(x => x.toLocaleLowerCase('ar'));
    const total = counts.filter(x => x.category && terms.some(t => x.category.toLocaleLowerCase('ar').includes(t) || t.includes(x.category.toLocaleLowerCase('ar')))).reduce((n,x)=>n+x.total,0);
    return {...c, listingCount:total};
  });
  res.json({ categories, count:categories.length, subcategoryCount:categories.reduce((n,c)=>n+c.children.length,0), totalActiveListings:counts.reduce((n,x)=>n+x.total,0) });
}));

app.get('/api/health', asyncRoute(async (req,res) => {
  await pool.query('SELECT 1');
  res.json({ ok:true, service:'SHAYN API', database:'connected' });
}));
app.post('/api/auth/register', asyncRoute(async (req,res) => {
  const name=String(req.body.name||'').trim(), email=String(req.body.email||'').trim().toLowerCase(), password=String(req.body.password||'');
  if(name.length<2 || name.length>120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length<10) return res.status(400).json({error:'أدخل اسماً وبريداً صحيحاً وكلمة مرور من 10 أحرف على الأقل'});
  const hash=await bcrypt.hash(password,12);
  try {
    const q=await pool.query('INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING *',[name,email,hash]);
    const user=q.rows[0]; res.status(201).json({token:issueToken(user),user:safeUser(user)});
  } catch(e) { if(e.code==='23505') return res.status(409).json({error:'هذا البريد مسجل مسبقاً'}); throw e; }
}));
app.post('/api/auth/login', asyncRoute(async(req,res)=>{
  const email=String(req.body.email||'').trim().toLowerCase(), password=String(req.body.password||'');
  const q=await pool.query('SELECT * FROM users WHERE email=$1 AND is_active=TRUE',[email]);
  if(!q.rowCount || !(await bcrypt.compare(password,q.rows[0].password_hash))) return res.status(401).json({error:'البريد أو كلمة المرور غير صحيحة'});
  res.json({token:issueToken(q.rows[0]),user:safeUser(q.rows[0])});
}));
app.get('/api/me',auth,asyncRoute(async(req,res)=>{
  const q=await pool.query('SELECT id,name,email,role,bio,created_at FROM users WHERE id=$1',[req.user.id]);
  if(!q.rowCount) return res.status(404).json({error:'الحساب غير موجود'});
  res.json({user:q.rows[0]});
}));

const PROFESSIONAL_ROLES = new Set(['job_seeker','employer','freelancer','service_provider','seller','buyer']);
const ORGANIZATION_KINDS = new Set(['company','ngo','public_entity','store','team','other']);
const ORGANIZATION_MEMBER_ROLES = new Set(['admin','recruiter','project_manager','commerce_manager','member']);
const ORGANIZATION_MANAGERS = new Set(['owner','admin']);

async function loadOrganizationMembership(req,res,allowedRoles) {
  const id = String(req.params.id || '');
  if (!/^[1-9]\d{0,17}$/.test(id)) {
    res.status(400).json({error:'معرّف المؤسسة غير صحيح'});
    return null;
  }
  const q = await pool.query(
    'SELECT o.id AS organization_id,o.name,o.slug,o.kind,o.status,m.role,m.status AS membership_status ' +
    'FROM organizations o JOIN organization_memberships m ON m.organization_id=o.id ' +
    'WHERE o.id=$1 AND m.user_id=$2 AND m.status=$3',
    [id,req.user.id,'active']
  );
  if (!q.rowCount) {
    res.status(403).json({error:'لا تملك عضوية فعالة في هذه المؤسسة'});
    return null;
  }
  const membership = q.rows[0];
  const hasAllowedRole = !allowedRoles || (allowedRoles instanceof Set ? allowedRoles.has(membership.role) : allowedRoles.includes(membership.role));
  if (!hasAllowedRole) {
    res.status(403).json({error:'لا تملك صلاحية تنفيذ هذا الإجراء داخل المؤسسة'});
    return null;
  }
  return membership;
}

// Professional roles are self-selected profile capabilities, never platform-admin privileges.
app.get('/api/me/roles',auth,identitySchemaRequired,asyncRoute(async(req,res)=>{
  const q = await pool.query(
    'SELECT role,created_at FROM user_roles WHERE user_id=$1 ORDER BY role',
    [req.user.id]
  );
  res.json({roles:q.rows});
}));
app.put('/api/me/roles',auth,identitySchemaRequired,asyncRoute(async(req,res)=>{
  if (!Array.isArray(req.body.roles) || req.body.roles.length > PROFESSIONAL_ROLES.size) {
    return res.status(400).json({error:'أرسل قائمة صحيحة بالصفات المهنية'});
  }
  const roles = [...new Set(req.body.roles.map(value=>String(value)))];
  if (roles.some(role=>!PROFESSIONAL_ROLES.has(role))) {
    return res.status(400).json({error:'تتضمن القائمة صفة مهنية غير مسموح بها'});
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM user_roles WHERE user_id=$1',[req.user.id]);
    for (const role of roles) {
      await client.query('INSERT INTO user_roles(user_id,role) VALUES($1,$2)',[req.user.id,role]);
    }
    await client.query('COMMIT');
    res.json({roles});
  } catch(error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.get('/api/organizations',auth,identitySchemaRequired,asyncRoute(async(req,res)=>{
  const q = await pool.query(
    'SELECT o.id,o.name,o.slug,o.kind,o.description,o.country_code,o.status,o.created_at,' +
    'm.role AS membership_role,m.status AS membership_status ' +
    'FROM organizations o JOIN organization_memberships m ON m.organization_id=o.id ' +
    'WHERE m.user_id=$1 AND m.status=$2 ORDER BY o.created_at DESC LIMIT 100',
    [req.user.id,'active']
  );
  res.json({organizations:q.rows});
}));
app.post('/api/organizations',auth,identitySchemaRequired,asyncRoute(async(req,res)=>{
  const name = String(req.body.name || '').trim();
  const slug = String(req.body.slug || '').trim().toLowerCase();
  const kind = String(req.body.kind || 'company');
  const description = String(req.body.description || '').trim();
  const countryCode = String(req.body.country_code || 'SY').trim().toUpperCase();
  if (name.length < 2 || name.length > 160 ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 160 ||
      !ORGANIZATION_KINDS.has(kind) || description.length > 4000 ||
      !/^[A-Z]{2}$/.test(countryCode)) {
    return res.status(400).json({error:'تحقق من اسم المؤسسة والرابط المختصر والنوع والبلد'});
  }
  const requiredRoles = {
    company:['employer'],
    ngo:['employer'],
    public_entity:['employer'],
    store:['seller'],
    team:['freelancer','service_provider'],
    other:['employer','seller','service_provider']
  }[kind];
  const roleCheck = await pool.query(
    'SELECT role FROM user_roles WHERE user_id=$1 AND role=ANY($2::varchar[])',
    [req.user.id,requiredRoles]
  );
  if (!roleCheck.rowCount) {
    return res.status(403).json({error:'أضف الصفة المهنية المناسبة إلى حسابك قبل إنشاء هذه المؤسسة'});
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const created = await client.query(
      'INSERT INTO organizations(name,slug,kind,description,country_code,owner_user_id) ' +
      'VALUES($1,$2,$3,$4,$5,$6) RETURNING id,name,slug,kind,description,country_code,status,created_at',
      [name,slug,kind,description || null,countryCode,req.user.id]
    );
    const organization = created.rows[0];
    await client.query(
      'INSERT INTO organization_memberships(organization_id,user_id,role,status) VALUES($1,$2,$3,$4)',
      [organization.id,req.user.id,'owner','active']
    );
    await client.query(
      'INSERT INTO organization_audit_logs(organization_id,actor_user_id,action,details) VALUES($1,$2,$3,$4::jsonb)',
      [organization.id,req.user.id,'organization.created',JSON.stringify({kind,slug,country_code:countryCode})]
    );
    await client.query('COMMIT');
    res.status(201).json({organization,membership_role:'owner'});
  } catch(error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') return res.status(409).json({error:'الرابط المختصر مستخدم مسبقاً'});
    throw error;
  } finally {
    client.release();
  }
}));
app.get('/api/organizations/:id',auth,identitySchemaRequired,asyncRoute(async(req,res)=>{
  const membership = await loadOrganizationMembership(req,res,null);
  if (!membership) return;
  const q = await pool.query(
    'SELECT id,name,slug,kind,description,country_code,status,created_at,updated_at ' +
    'FROM organizations WHERE id=$1',
    [membership.organization_id]
  );
  res.json({organization:q.rows[0],membership_role:membership.role});
}));
app.get('/api/organizations/:id/members',auth,identitySchemaRequired,asyncRoute(async(req,res)=>{
  const membership = await loadOrganizationMembership(req,res,['owner','admin']);
  if (!membership) return;
  const q = await pool.query(
    'SELECT m.user_id,u.name,u.email,m.role,m.status,m.created_at ' +
    'FROM organization_memberships m JOIN users u ON u.id=m.user_id ' +
    'WHERE m.organization_id=$1 ORDER BY m.created_at ASC LIMIT 200',
    [membership.organization_id]
  );
  res.json({members:q.rows});
}));
app.post('/api/organizations/:id/invitations',auth,identitySchemaRequired,asyncRoute(async(req,res)=>{
  const membership = await loadOrganizationMembership(req,res,ORGANIZATION_MANAGERS);
  if (!membership) return;
  const email = String(req.body.email || '').trim().toLowerCase();
  const role = String(req.body.role || 'member');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255 ||
      !ORGANIZATION_MEMBER_ROLES.has(role)) {
    return res.status(400).json({error:'البريد أو صلاحية العضوية غير صحيحة'});
  }
  if (email === String(req.user.email).toLowerCase()) {
    return res.status(409).json({error:'أنت عضو في المؤسسة بالفعل'});
  }
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const created = await client.query(
      'INSERT INTO organization_invitations(organization_id,email,role,token_hash,invited_by_user_id,expires_at) ' +
      "VALUES($1,$2,$3,$4,$5,NOW()+INTERVAL '7 days') " +
      'RETURNING id,email,role,status,expires_at',
      [membership.organization_id,email,role,tokenHash,req.user.id]
    );
    await client.query(
      'INSERT INTO organization_audit_logs(organization_id,actor_user_id,action,details) VALUES($1,$2,$3,$4::jsonb)',
      [membership.organization_id,req.user.id,'organization.invitation.created',JSON.stringify({invitation_id:created.rows[0].id,email,role})]
    );
    await client.query('COMMIT');
    res.status(201).json({
      invitation:created.rows[0],
      invite_token:token,
      delivery:'manual',
      message:'لم يُفعّل إرسال البريد بعد؛ شارك رمز الدعوة مع الشخص المقصود عبر قناة آمنة'
    });
  } catch(error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));
app.post('/api/organizations/invitations/accept',auth,identitySchemaRequired,asyncRoute(async(req,res)=>{
  const token = String(req.body.token || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(token)) return res.status(400).json({error:'رمز الدعوة غير صحيح'});
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query(
      'SELECT id,organization_id,email,role,status,expires_at,invited_by_user_id ' +
      'FROM organization_invitations WHERE token_hash=$1 FOR UPDATE',
      [tokenHash]
    );
    if (!found.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({error:'الدعوة غير موجودة أو لم تعد صالحة'});
    }
    const invitation = found.rows[0];
    if (invitation.status !== 'pending' || new Date(invitation.expires_at).getTime() <= Date.now()) {
      await client.query('ROLLBACK');
      return res.status(409).json({error:'انتهت صلاحية الدعوة أو تم استخدامها سابقاً'});
    }
    if (String(invitation.email).toLowerCase() !== String(req.user.email).toLowerCase()) {
      await client.query('ROLLBACK');
      return res.status(403).json({error:'يجب تسجيل الدخول بالبريد الذي تلقيت عليه الدعوة'});
    }
    await client.query(
      'INSERT INTO organization_memberships(organization_id,user_id,role,status,invited_by_user_id) ' +
      "VALUES($1,$2,$3,'active',$4) " +
      "ON CONFLICT (organization_id,user_id) DO UPDATE SET role=EXCLUDED.role,status='active',invited_by_user_id=EXCLUDED.invited_by_user_id,updated_at=NOW()",
      [invitation.organization_id,req.user.id,invitation.role,invitation.invited_by_user_id]
    );
    await client.query(
      "UPDATE organization_invitations SET status='accepted',accepted_by_user_id=$1,accepted_at=NOW() WHERE id=$2",
      [req.user.id,invitation.id]
    );
    await client.query(
      'INSERT INTO organization_audit_logs(organization_id,actor_user_id,target_user_id,action,details) VALUES($1,$2,$3,$4,$5::jsonb)',
      [invitation.organization_id,req.user.id,req.user.id,'organization.invitation.accepted',JSON.stringify({invitation_id:invitation.id,role:invitation.role})]
    );
    await client.query('COMMIT');
    res.json({organization_id:invitation.organization_id,role:invitation.role,status:'active'});
  } catch(error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));
app.get('/api/organizations/:id/audit',auth,identitySchemaRequired,asyncRoute(async(req,res)=>{
  const membership = await loadOrganizationMembership(req,res,ORGANIZATION_MANAGERS);
  if (!membership) return;
  const q = await pool.query(
    'SELECT id,actor_user_id,target_user_id,action,details,created_at ' +
    'FROM organization_audit_logs WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 100',
    [membership.organization_id]
  );
  res.json({audit_logs:q.rows});
}));

app.get('/api/listings',asyncRoute(async(req,res)=>{
  const values=[],where=[`l.status='active'`];
  if(req.query.type && TYPES.has(req.query.type)){values.push(req.query.type);where.push(`l.type=$${values.length}`);}
  // Category browsing uses a dedicated filter instead of pretending category
  // labels are free-text product titles. Expand parent categories to their
  // subcategories and support common short labels used by storefront tiles.
  if(req.query.category){
    const raw=String(req.query.category).trim().slice(0,120);
    const lower=raw.toLocaleLowerCase('ar');
    const aliases={
      'إلكترونيات':'الهواتف والإلكترونيات','الالكترونيات':'الهواتف والإلكترونيات',
      'أزياء':'الأزياء والملابس','الموضة':'الأزياء والملابس',
      'المنزل':'المنزل والأثاث','الجمال':'الجمال والعناية',
      'السيارات':'السيارات والمركبات','خدمات':'الخدمات','الخدمات والأعمال':'الخدمات'
    };
    const canonical=aliases[lower]||raw;
    const parent=CATEGORY_NAMES.find(c=>c.name.toLocaleLowerCase('ar')===canonical.toLocaleLowerCase('ar') ||
      c.name.toLocaleLowerCase('ar').includes(canonical.toLocaleLowerCase('ar')) ||
      canonical.toLocaleLowerCase('ar').includes(c.name.toLocaleLowerCase('ar')) ||
      c.children.some(x=>x.toLocaleLowerCase('ar')===canonical.toLocaleLowerCase('ar')));
    const terms=parent && (parent.name.toLocaleLowerCase('ar')===canonical.toLocaleLowerCase('ar') ||
      parent.name.toLocaleLowerCase('ar').includes(canonical.toLocaleLowerCase('ar')) ||
      canonical.toLocaleLowerCase('ar').includes(parent.name.toLocaleLowerCase('ar')))
      ? [parent.name,...parent.children] : [raw,canonical];
    const clauses=terms.map(term=>{values.push('%'+term+'%');return `COALESCE(l.category,'') ILIKE $${values.length}`;});
    where.push('('+clauses.join(' OR ')+')');
  }
  if(req.query.q){
    const term=String(req.query.q).trim().slice(0,100);
    const lower=term.toLocaleLowerCase('ar');
    const matched=CATEGORY_NAMES.find(c=>c.name.toLocaleLowerCase('ar').includes(lower) || lower.includes(c.name.toLocaleLowerCase('ar')) || c.children.some(x=>x.toLocaleLowerCase('ar')===lower));
    const terms=matched ? [matched.name,...matched.children] : [term];
    const p=values.length+1; values.push('%'+term+'%');
    const categoryParams=terms.map(t=>{values.push('%'+t+'%');return `COALESCE(l.category,'') ILIKE $${values.length}`;});
    const typeMatch=(/خدمات|خدمة|توصيل|صيانة|تصميم|تصوير|تعليم/.test(lower)) ? " OR l.type='service'" :
      (/منتجات|منتج|تسوق|تسوّق|بضائع/.test(lower)) ? " OR l.type='market'" :
      (/طلبات شراء|طلب شراء/.test(lower)) ? " OR l.type='project'" : "";
    where.push(`(l.title ILIKE $${p} OR l.description ILIKE $${p} OR ${categoryParams.join(' OR ')}${typeMatch})`);
  }
  const q=await pool.query(`SELECT l.id,l.type,l.title,l.description,l.category,l.price,l.currency,l.location,l.image_url,l.entity_name,l.entity_kind,l.website,l.contact_phone,l.created_at,u.name AS owner_name,u.id AS owner_id FROM listings l JOIN users u ON u.id=l.user_id WHERE ${where.join(' AND ')} ORDER BY l.created_at DESC LIMIT 60`,values);
  res.json({listings:q.rows});
}));
app.post('/api/listings',auth,asyncRoute(async(req,res)=>{
  const {type,title,description,category,price,currency,location,image_url,entity_name,entity_kind,website,contact_phone}=req.body;
  if(!TYPES.has(type)||String(title||'').trim().length<4||String(title).length>180||String(description||'').trim().length<10) return res.status(400).json({error:'تحقق من نوع الإعلان والعنوان والوصف (10 أحرف على الأقل)'});
  const entity=String(entity_name||'').trim(), site=String(website||'').trim(), phone=String(contact_phone||'').trim();
  if(type==='business' && entity.length<2) return res.status(400).json({error:'أدخل اسم الشركة أو الجهة'});
  if(site && (!/^https:\/\//i.test(site)||site.length>300)) return res.status(400).json({error:'رابط الموقع يجب أن يبدأ بـ https://'});
  if(phone.length>40) return res.status(400).json({error:'رقم التواصل طويل جداً'});
  const image=String(image_url||'').trim();
  if(image && (!/^https:\/\//i.test(image) || image.length>1200)) return res.status(400).json({error:'رابط الصورة يجب أن يبدأ بـ https://'});
  const p=price===''||price==null?null:Number(price);
  if(p!==null&&(!Number.isFinite(p)||p<0)) return res.status(400).json({error:'السعر غير صحيح'});
  if(type==='market'&&p===null) return res.status(400).json({error:'أدخل سعر المنتج قبل نشره'});
  const q=await pool.query('INSERT INTO listings(user_id,type,title,description,category,price,currency,location,image_url,entity_name,entity_kind,website,contact_phone) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *',[req.user.id,type,String(title).trim(),String(description).trim(),category||null,p,currency||'USD',location||null,image||null,entity||null,entity_kind||null,site||null,phone||null]);
  res.status(201).json({listing:q.rows[0]});
}));
app.post('/api/listings/:id/apply',auth,asyncRoute(async(req,res)=>{
  const q=await pool.query('INSERT INTO applications(listing_id,user_id,message) SELECT id,$2,$3 FROM listings WHERE id=$1 AND status=\'active\' RETURNING *',[req.params.id,req.user.id,String(req.body.message||'').slice(0,2000)]);
  if(!q.rowCount) return res.status(404).json({error:'الإعلان غير موجود أو مغلق'});
  res.status(201).json({application:q.rows[0]});
}));
app.post('/api/messages',auth,asyncRoute(async(req,res)=>{
  const recipient=Number(req.body.recipient_id), body=String(req.body.body||'').trim();
  if(!Number.isInteger(recipient)||recipient===req.user.id||body.length<1||body.length>4000) return res.status(400).json({error:'بيانات الرسالة غير صحيحة'});
  const q=await pool.query('INSERT INTO messages(sender_id,recipient_id,listing_id,body) VALUES($1,$2,$3,$4) RETURNING *',[req.user.id,recipient,req.body.listing_id||null,body]);
  res.status(201).json({message:q.rows[0]});
}));
app.get('/api/messages',auth,asyncRoute(async(req,res)=>{
  const q=await pool.query(`SELECT m.*,s.name AS sender_name,r.name AS recipient_name FROM messages m JOIN users s ON s.id=m.sender_id JOIN users r ON r.id=m.recipient_id WHERE m.sender_id=$1 OR m.recipient_id=$1 ORDER BY m.created_at DESC LIMIT 100`,[req.user.id]);
  res.json({messages:q.rows});
}));
app.post('/api/reviews',auth,asyncRoute(async(req,res)=>{
  const target=Number(req.body.reviewed_user_id), rating=Number(req.body.rating);
  if(!Number.isInteger(target)||target===req.user.id||rating<1||rating>5) return res.status(400).json({error:'بيانات التقييم غير صحيحة'});
  const q=await pool.query('INSERT INTO reviews(reviewer_id,reviewed_user_id,rating,comment) VALUES($1,$2,$3,$4) RETURNING *',[req.user.id,target,rating,String(req.body.comment||'').slice(0,1500)]);
  res.status(201).json({review:q.rows[0]});
}));
app.post('/api/reports',auth,asyncRoute(async(req,res)=>{
  const reason=String(req.body.reason||'').trim();
  if(reason.length<5) return res.status(400).json({error:'يرجى توضيح سبب البلاغ'});
  const q=await pool.query('INSERT INTO reports(reporter_id,listing_id,reported_user_id,reason) VALUES($1,$2,$3,$4) RETURNING *',[req.user.id,req.body.listing_id||null,req.body.reported_user_id||null,reason.slice(0,2000)]);
  res.status(201).json({report:q.rows[0]});
}));

// Orders: checkout records an order in PostgreSQL; payment is not collected online yet.
app.post('/api/orders',auth,asyncRoute(async(req,res)=>{
  const items=Array.isArray(req.body.items)?req.body.items:[];
  const buyerName=String(req.body.buyer_name||'').trim().slice(0,120);
  const buyerPhone=String(req.body.buyer_phone||'').trim().slice(0,40);
  const address=String(req.body.delivery_address||'').trim().slice(0,1000);
  if(!items.length||items.length>20||buyerName.length<2||buyerPhone.length<5||address.length<5)
    return res.status(400).json({error:'أدخل بيانات التوصيل وأضف منتجاً واحداً على الأقل'});
  const quantities=new Map();
  for(const item of items){
    const id=Number(item.listing_id), qty=Number(item.quantity);
    if(!Number.isInteger(id)||id<1||!Number.isInteger(qty)||qty<1||qty>50)
      return res.status(400).json({error:'بيانات المنتجات أو الكميات غير صحيحة'});
    quantities.set(id,(quantities.get(id)||0)+qty);
  }
  if([...quantities.values()].some(q=>q>50)) return res.status(400).json({error:'الحد الأعلى للكمية الواحدة هو 50'});
  const ids=[...quantities.keys()];
  const found=await pool.query("SELECT id,user_id,title,price,currency FROM listings WHERE id=ANY($1::bigint[]) AND type='market' AND status='active' AND price IS NOT NULL",[ids]);
  if(found.rowCount!==ids.length) return res.status(409).json({error:'بعض المنتجات لم تعد متاحة للبيع'});
  const sellerIds=new Set(found.rows.map(x=>String(x.user_id)));
  const currencies=new Set(found.rows.map(x=>String(x.currency||'USD')));
  if(sellerIds.size!==1||currencies.size!==1) return res.status(400).json({error:'لإتمام الطلب، اختر منتجات من بائع واحد وبعملة واحدة'});
  const products=new Map(found.rows.map(x=>[String(x.id),x]));
  const total=found.rows.reduce((sum,x)=>sum+Number(x.price)*quantities.get(Number(x.id)),0);
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const order=await client.query(
      'INSERT INTO orders(buyer_id,seller_id,buyer_name,buyer_phone,delivery_address,total,currency) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [req.user.id,found.rows[0].user_id,buyerName,buyerPhone,address,total,[...currencies][0]]
    );
    for(const [id,qty] of quantities){
      const product=products.get(String(id)), price=Number(product.price);
      await client.query(
        'INSERT INTO order_items(order_id,listing_id,product_title,unit_price,quantity,line_total) VALUES($1,$2,$3,$4,$5,$6)',
        [order.rows[0].id,product.id,product.title,price,qty,price*qty]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({order:order.rows[0]});
  }catch(error){await client.query('ROLLBACK');throw error;}
  finally{client.release();}
}));
app.get('/api/orders',auth,asyncRoute(async(req,res)=>{
  const q=await pool.query(`
    SELECT o.*,u.name AS seller_name,
      COALESCE(json_agg(json_build_object('title',i.product_title,'price',i.unit_price,'quantity',i.quantity,'line_total',i.line_total)) FILTER (WHERE i.id IS NOT NULL),'[]'::json) AS items
    FROM orders o JOIN users u ON u.id=o.seller_id
    LEFT JOIN order_items i ON i.order_id=o.id
    WHERE o.buyer_id=$1 GROUP BY o.id,u.name ORDER BY o.created_at DESC LIMIT 100
  `,[req.user.id]);
  res.json({orders:q.rows});
}));
app.get('/api/seller/orders',auth,asyncRoute(async(req,res)=>{
  const q=await pool.query(`
    SELECT o.*,u.name AS buyer_account_name,
      COALESCE(json_agg(json_build_object('title',i.product_title,'price',i.unit_price,'quantity',i.quantity,'line_total',i.line_total)) FILTER (WHERE i.id IS NOT NULL),'[]'::json) AS items
    FROM orders o JOIN users u ON u.id=o.buyer_id
    LEFT JOIN order_items i ON i.order_id=o.id
    WHERE o.seller_id=$1 GROUP BY o.id,u.name ORDER BY o.created_at DESC LIMIT 100
  `,[req.user.id]);
  res.json({orders:q.rows});
}));
app.patch('/api/seller/orders/:id',auth,asyncRoute(async(req,res)=>{
  const status=String(req.body.status||'');
  if(!['confirmed','preparing','shipped','completed','cancelled'].includes(status))
    return res.status(400).json({error:'حالة الطلب غير صحيحة'});
  const q=await pool.query('UPDATE orders SET status=$1,updated_at=NOW() WHERE id=$2 AND seller_id=$3 RETURNING *',[status,req.params.id,req.user.id]);
  if(!q.rowCount)return res.status(404).json({error:'الطلب غير موجود ضمن طلبات متجرك'});
  res.json({order:q.rows[0]});
}));

app.get('/api/admin/overview',auth,admin,asyncRoute(async(req,res)=>{
  const q=await pool.query(`SELECT (SELECT COUNT(*) FROM users) users,(SELECT COUNT(*) FROM listings) listings,(SELECT COUNT(*) FROM orders) orders,(SELECT COUNT(*) FROM applications) applications,(SELECT COUNT(*) FROM reports WHERE status='open') open_reports`);
  res.json(q.rows[0]);
}));
app.get('/api/admin/listings',auth,admin,asyncRoute(async(req,res)=>{
  const q=await pool.query('SELECT l.*,u.name owner_name FROM listings l JOIN users u ON u.id=l.user_id ORDER BY l.created_at DESC LIMIT 100');res.json({listings:q.rows});
}));
app.patch('/api/admin/listings/:id',auth,admin,asyncRoute(async(req,res)=>{
  const status=String(req.body.status||'');
  if(!['active','paused','closed','rejected'].includes(status)) return res.status(400).json({error:'حالة غير صحيحة'});
  const q=await pool.query('UPDATE listings SET status=$1 WHERE id=$2 RETURNING *',[status,req.params.id]);
  if(!q.rowCount)return res.status(404).json({error:'الإعلان غير موجود'});res.json({listing:q.rows[0]});
}));
app.get('/api/admin/reports',auth,admin,asyncRoute(async(req,res)=>{
  const q=await pool.query('SELECT r.*,u.name reporter_name FROM reports r JOIN users u ON u.id=r.reporter_id ORDER BY r.created_at DESC LIMIT 100');res.json({reports:q.rows});
}));
app.patch('/api/admin/reports/:id',auth,admin,asyncRoute(async(req,res)=>{
  const status=String(req.body.status||'');
  if(!['open','reviewing','resolved','dismissed'].includes(status))return res.status(400).json({error:'حالة غير صحيحة'});
  const q=await pool.query('UPDATE reports SET status=$1 WHERE id=$2 RETURNING *',[status,req.params.id]);if(!q.rowCount)return res.status(404).json({error:'البلاغ غير موجود'});res.json({report:q.rows[0]});
}));
app.patch('/api/admin/users/:id/role',auth,superAdmin,asyncRoute(async(req,res)=>{
  const role=String(req.body.role||'');
  if(!['user','moderator','admin'].includes(role))return res.status(400).json({error:'دور غير صحيح'});
  const target=await pool.query('SELECT id,email,role FROM users WHERE id=$1',[req.params.id]);
  if(!target.rowCount)return res.status(404).json({error:'المستخدم غير موجود'});
  if(target.rows[0].role==='super_admin' || target.rows[0].email.toLowerCase()===ADMIN_EMAIL) {
    return res.status(403).json({error:'لا يمكن تغيير حساب المدير الأعلى من هذه الواجهة'});
  }
  const q=await pool.query("UPDATE users SET role=$1,updated_at=NOW() WHERE id=$2 AND role <> 'super_admin' RETURNING id,name,email,role",[role,req.params.id]);
  if(!q.rowCount)return res.status(409).json({error:'تعذر تغيير صلاحية هذا الحساب'});
  res.json({user:q.rows[0]});
}));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:process.env.NODE_ENV==='production'?'حدث خطأ داخلي':'حدث خطأ داخلي: '+err.message});});
if(process.argv.includes('--init-db')) initDb().then(()=>pool.end()).catch(e=>{console.error(e);process.exit(1);});
else {
  if(!JWT_SECRET || JWT_SECRET.length<32 || JWT_SECRET.includes('replace-with')) {
    console.error('JWT_SECRET must be set to a unique random value of at least 32 characters.');
    process.exit(1);
  }
  // Initialize the isolated SHAYN schema and all required tables before
  // accepting traffic. Previously production only attempted optional columns;
  // on a fresh database users/listings tables did not exist, breaking signup,
  // login, category browsing and search.
  initDb()
    .then(() => app.listen(PORT,()=>console.log(`SHAYN ready on port ${PORT}`)))
    .catch(error => {
      console.error('SHAYN database initialization failed; refusing to serve an empty/broken app:', error);
      process.exit(1);
    });
}

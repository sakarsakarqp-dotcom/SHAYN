require('dotenv').config();
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'Alswrya255@gmail.com').trim().toLowerCase();
const SHAYN_SCHEMA = 'shayn';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${SHAYN_SCHEMA}`, ssl: process.env.DATABASE_SSL === 'false' ? false : (process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined) });

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: false, limit: '50kb' }));
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use(express.static(path.join(__dirname,'public')));

const TYPES = new Set(['job','project','service','market']);

const CATEGORY_NAMES = [
  ['الأزياء والملابس','ملابس نسائية','ملابس رجالية','ملابس أطفال','أحذية','حقائب','إكسسوارات','ساعات','ملابس رياضية','ملابس مناسبات'],
  ['الهواتف والإلكترونيات','هواتف ذكية','أجهزة لوحية','حواسيب محمولة','حواسيب مكتبية','شاشات','سماعات','كاميرات','أجهزة ألعاب','إكسسوارات إلكترونية'],
  ['المنزل والأثاث','أثاث غرف النوم','أثاث غرف الجلوس','مطابخ','أدوات منزلية','ديكور','إنارة','مفروشات','أجهزة منزلية','حدائق'],
  ['الجمال والعناية','عطور','مستحضرات تجميل','العناية بالبشرة','العناية بالشعر','العناية الشخصية','مستلزمات صالونات'],
  ['الأطفال والألعاب','ألعاب أطفال','عربات ومقاعد','ملابس أطفال','مستلزمات الرضع','ألعاب تعليمية'],
  ['السيارات والمركبات','سيارات','دراجات نارية','قطع غيار','إطارات','زيوت وسوائل','إكسسوارات سيارات'],
  ['الرياضة والرحلات','معدات رياضية','ملابس رياضية','معدات تخييم','دراجات','مستلزمات الرحلات'],
  ['الأغذية والمشروبات','مواد غذائية','منتجات محلية','حلويات ومخبوزات','قهوة وشاي','منتجات زراعية'],
  ['الكتب والقرطاسية','كتب','قرطاسية','مستلزمات مكتبية','أدوات فنية','مستلزمات مدرسية'],
  ['الصحة والمستلزمات الطبية','مستلزمات طبية عامة','أجهزة قياس','معدات رعاية منزلية','مستلزمات صيدلانية غير دوائية'],
  ['الحيوانات الأليفة','أغذية الحيوانات','مستلزمات القطط','مستلزمات الكلاب','أقفاص وأحواض','إكسسوارات'],
  ['الأدوات والمعدات','أدوات يدوية','معدات كهربائية','معدات ورش','معدات زراعية','أدوات قياس'],
  ['الخدمات','خدمات التوصيل','الصيانة','التصميم','التسويق','التعليم والتدريب','التصوير','الخدمات الرقمية'],
  ['العقارات','شقق للبيع','شقق للإيجار','منازل','محال تجارية','أراضٍ','مكاتب'],
  ['الأعمال والفرص التجارية','شراكات تجارية','امتيازات تجارية','توريد بالجملة','فرص استثمارية','طلبات شراء'],
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
const issueToken = u => jwt.sign({ id: u.id }, JWT_SECRET, { expiresIn: '7d' });

async function initDb() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is missing');
  if (!JWT_SECRET || JWT_SECRET.length < 32 || JWT_SECRET.includes('replace-with')) throw new Error('Set a strong JWT_SECRET (at least 32 characters)');
  const fs = require('fs');
  // Keep SHAYN isolated from ATHAR's public schema. The migration preserves
  // existing SHAYN tables by moving the known legacy tables as a single unit.
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${SHAYN_SCHEMA}`);
  await pool.query(fs.readFileSync(path.join(__dirname,'migrations','003_isolate_shayn_schema.sql'),'utf8'));
  await pool.query(fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8'));
  await pool.query(fs.readFileSync(path.join(__dirname,'migrations','004_commerce_images.sql'),'utf8'));
  await pool.query(fs.readFileSync(path.join(__dirname,'migrations','002_admin_security.sql'),'utf8'));
  const name = process.env.ADMIN_NAME || 'أمير السوري';
  const password = process.env.ADMIN_PASSWORD;
  if (password) {
    const hash = await bcrypt.hash(password, 12);
    await pool.query(`INSERT INTO users(name,email,password_hash,role,is_active) VALUES($1,$2,$3,'super_admin',TRUE)
      ON CONFLICT(email) DO UPDATE SET name=EXCLUDED.name, role='super_admin', password_hash=EXCLUDED.password_hash, is_active=TRUE, updated_at=NOW()`,[name,ADMIN_EMAIL,hash]);
  } else {
    // إذا كان الحساب قد أُنشئ سابقاً، نرفع صلاحياته دون تغيير كلمة مروره.
    await pool.query(`UPDATE users SET name=$1, role='super_admin', is_active=TRUE, updated_at=NOW() WHERE email=$2`,[name,ADMIN_EMAIL]);
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
app.get('/api/listings',asyncRoute(async(req,res)=>{
  const values=[],where=[`l.status='active'`];
  if(req.query.type && TYPES.has(req.query.type)){values.push(req.query.type);where.push(`l.type=$${values.length}`);}
  if(req.query.q){
    const term=String(req.query.q).trim().slice(0,100);
    const lower=term.toLocaleLowerCase('ar');
    const matched=CATEGORY_NAMES.find(c=>c.name.toLocaleLowerCase('ar').includes(lower) || lower.includes(c.name.toLocaleLowerCase('ar')) || c.children.some(x=>x.toLocaleLowerCase('ar')===lower));
    const terms=matched ? [matched.name,...matched.children] : [term];
    const p=values.length+1; values.push('%'+term+'%');
    const categoryParams=terms.map(t=>{values.push('%'+t+'%');return `COALESCE(l.category,'') ILIKE ${values.length}`;});
    const typeMatch=(/خدمات|خدمة|توصيل|صيانة|تصميم|تصوير|تعليم/.test(lower)) ? " OR l.type='service'" :
      (/منتجات|منتج|تسوق|تسوّق|بضائع/.test(lower)) ? " OR l.type='market'" :
      (/طلبات شراء|طلب شراء/.test(lower)) ? " OR l.type='project'" : "";
    where.push(`(l.title ILIKE ${p} OR l.description ILIKE ${p} OR ${categoryParams.join(' OR ')}${typeMatch})`);
  }
  const q=await pool.query(`SELECT l.id,l.type,l.title,l.description,l.category,l.price,l.currency,l.location,l.image_url,l.created_at,u.name AS owner_name,u.id AS owner_id FROM listings l JOIN users u ON u.id=l.user_id WHERE ${where.join(' AND ')} ORDER BY l.created_at DESC LIMIT 60`,values);
  res.json({listings:q.rows});
}));
app.post('/api/listings',auth,asyncRoute(async(req,res)=>{
  const {type,title,description,category,price,currency,location,image_url}=req.body;
  if(!TYPES.has(type)||String(title||'').trim().length<4||String(title).length>180||String(description||'').trim().length<10) return res.status(400).json({error:'تحقق من نوع الإعلان والعنوان والوصف (10 أحرف على الأقل)'});
  const image=String(image_url||'').trim();
  if(image && (!/^https:\/\//i.test(image) || image.length>1200)) return res.status(400).json({error:'رابط الصورة يجب أن يبدأ بـ https://'});
  const p=price===''||price==null?null:Number(price);
  if(p!==null&&(!Number.isFinite(p)||p<0)) return res.status(400).json({error:'السعر غير صحيح'});
  const q=await pool.query('INSERT INTO listings(user_id,type,title,description,category,price,currency,location,image_url) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[req.user.id,type,String(title).trim(),String(description).trim(),category||null,p,currency||'USD',location||null,image||null]);
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
app.get('/api/admin/overview',auth,admin,asyncRoute(async(req,res)=>{
  const q=await pool.query(`SELECT (SELECT COUNT(*) FROM users) users,(SELECT COUNT(*) FROM listings) listings,(SELECT COUNT(*) FROM applications) applications,(SELECT COUNT(*) FROM reports WHERE status='open') open_reports`);
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
  // Safe additive compatibility migration for existing SHAYN databases.
  // The image column is optional; this never changes or removes existing data.
  (async () => {
    try {
      await pool.query('ALTER TABLE listings ADD COLUMN IF NOT EXISTS image_url TEXT');
      console.log('SHAYN commerce image field is ready.');
    } catch (error) {
      console.error('SHAYN optional image-field migration deferred:', error.message);
    }
    app.listen(PORT,()=>console.log(`SHAYN listening on port ${PORT}`));
  })();
}

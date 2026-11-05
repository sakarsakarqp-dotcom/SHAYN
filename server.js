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
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'false' ? false : (process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined) });

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: false, limit: '50kb' }));
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use(express.static(path.join(__dirname)));

const TYPES = new Set(['job','project','service','market']);
const safeUser = u => ({ id: u.id, name: u.name, email: u.email, role: u.role, bio: u.bio, created_at: u.created_at });
const asyncRoute = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
function auth(req,res,next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i,'');
  if (!token) return res.status(401).json({ error: 'يلزم تسجيل الدخول' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: 'جلسة الدخول غير صالحة، سجل الدخول مجدداً' }); }
}
function admin(req,res,next) {
  if (!['admin','moderator'].includes(req.user.role)) return res.status(403).json({ error: 'لا تملك صلاحية تنفيذ هذا الإجراء' });
  next();
}
const issueToken = u => jwt.sign({ id: u.id, role: u.role, email: u.email }, JWT_SECRET, { expiresIn: '7d' });

async function initDb() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is missing');
  if (!JWT_SECRET || JWT_SECRET.length < 32 || JWT_SECRET.includes('replace-with')) throw new Error('Set a strong JWT_SECRET (at least 32 characters)');
  const fs = require('fs');
  await pool.query(fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8'));
  const email = (process.env.ADMIN_EMAIL || 'Alswrya255@gmail.com').toLowerCase();
  const name = process.env.ADMIN_NAME || 'أمير السوري';
  const password = process.env.ADMIN_PASSWORD;
  if (password) {
    const hash = await bcrypt.hash(password, 12);
    await pool.query(`INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'admin')
      ON CONFLICT(email) DO UPDATE SET name=EXCLUDED.name, role='admin'`,[name,email,hash]);
    const existing = await pool.query('SELECT id FROM users WHERE email=$1',[email]);
    if (existing.rowCount) await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2 AND password_hash IS NULL',[hash,existing.rows[0].id]);
  }
  console.log('SHAYN database schema initialized.');
}

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
  const q=await pool.query('SELECT * FROM users WHERE email=$1',[email]);
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
  if(req.query.q){values.push('%'+String(req.query.q).slice(0,100)+'%');where.push(`(l.title ILIKE $${values.length} OR l.description ILIKE $${values.length} OR COALESCE(l.category,'') ILIKE $${values.length})`);}
  const q=await pool.query(`SELECT l.id,l.type,l.title,l.description,l.category,l.price,l.currency,l.location,l.created_at,u.name AS owner_name,u.id AS owner_id FROM listings l JOIN users u ON u.id=l.user_id WHERE ${where.join(' AND ')} ORDER BY l.created_at DESC LIMIT 60`,values);
  res.json({listings:q.rows});
}));
app.post('/api/listings',auth,asyncRoute(async(req,res)=>{
  const {type,title,description,category,price,currency,location}=req.body;
  if(!TYPES.has(type)||String(title||'').trim().length<4||String(title).length>180||String(description||'').trim().length<10) return res.status(400).json({error:'تحقق من نوع الإعلان والعنوان والوصف (10 أحرف على الأقل)'});
  const p=price===''||price==null?null:Number(price);
  if(p!==null&&(!Number.isFinite(p)||p<0)) return res.status(400).json({error:'السعر غير صحيح'});
  const q=await pool.query('INSERT INTO listings(user_id,type,title,description,category,price,currency,location) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[req.user.id,type,String(title).trim(),String(description).trim(),category||null,p,currency||'USD',location||null]);
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
app.patch('/api/admin/users/:id/role',auth,admin,asyncRoute(async(req,res)=>{
  const role=String(req.body.role||'');
  if(!['user','moderator','admin'].includes(role))return res.status(400).json({error:'دور غير صحيح'});
  if(Number(req.params.id)===req.user.id && role!=='admin')return res.status(400).json({error:'لا يمكنك خفض صلاحيتك بنفسك'});
  const q=await pool.query('UPDATE users SET role=$1 WHERE id=$2 RETURNING id,name,email,role',[role,req.params.id]);if(!q.rowCount)return res.status(404).json({error:'المستخدم غير موجود'});res.json({user:q.rows[0]});
}));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'index.html')));
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:process.env.NODE_ENV==='production'?'حدث خطأ داخلي':'حدث خطأ داخلي: '+err.message});});
if(process.argv.includes('--init-db')) initDb().then(()=>pool.end()).catch(e=>{console.error(e);process.exit(1);});
else {
  if(!JWT_SECRET || JWT_SECRET.length<32 || JWT_SECRET.includes('replace-with')) console.warn('WARNING: Set a strong JWT_SECRET before using authentication.');
  app.listen(PORT,()=>console.log(`SHAYN listening on port ${PORT}`));
}

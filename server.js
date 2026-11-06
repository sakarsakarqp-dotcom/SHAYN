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
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'false' ? false : (process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined) });

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: false, limit: '50kb' }));
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use(express.static(path.join(__dirname,'public')));

const TYPES = new Set(['job','project','service','market']);

const CATEGORY_NAMES = [
  ['التقنية والبرمجة','تطوير الويب','تطبيقات الهاتف','برمجة الواجهات','برمجة الخلفيات','قواعد البيانات','الذكاء الاصطناعي','الأمن السيبراني','الشبكات','الحوسبة السحابية','اختبار البرمجيات','DevOps','الدعم التقني'],
  ['التصميم والإبداع','تصميم الشعارات','الهوية البصرية','تصميم UI/UX','تصميم المطبوعات','تصميم الإعلانات','تصميم ثلاثي الأبعاد','الموشن غرافيك','الرسم الرقمي','تحرير الصور','تصميم التغليف','تصميم العروض','الخطوط'],
  ['التسويق والمبيعات','التسويق الرقمي','إدارة الحملات','تحسين محركات البحث','إدارة السوشيال ميديا','كتابة المحتوى','التسويق بالبريد','تحليل السوق','المبيعات الهاتفية','تطوير الأعمال','العلاقات العامة','إدارة العلامات','خدمة العملاء'],
  ['الإعلام والصحافة','الصحافة المكتوبة','التصوير الصحفي','إعداد التقارير','المونتاج','الإنتاج التلفزيوني','التقديم والإعداد','التدقيق اللغوي','الترجمة الإعلامية','البودكاست','إدارة النشر','التحقق من الأخبار','صناعة الفيديو'],
  ['الإدارة والأعمال','إدارة المشاريع','إدارة العمليات','الموارد البشرية','إدارة المكاتب','التخطيط الاستراتيجي','إدارة الجودة','إدارة المشتريات','ريادة الأعمال','السكرتاريا','إدارة المخاطر','إدارة الفرق','الاستشارات'],
  ['المالية والمحاسبة','المحاسبة العامة','المحاسبة الإدارية','التدقيق المالي','التحليل المالي','إعداد الموازنات','الضرائب','الرواتب','مسك الدفاتر','الخدمات المصرفية','التأمين','التمويل','الاستثمار'],
  ['التعليم والتدريب','التعليم المدرسي','التعليم الجامعي','التعليم عن بعد','تدريس اللغات','التدريب المهني','التدريب الإداري','التدريب التقني','إعداد المناهج','التدريس الخصوصي','التعليم المبكر','التوجيه الأكاديمي','التعليم الدامج'],
  ['الترجمة واللغات','الترجمة الإنجليزية','الترجمة التركية','الترجمة العربية','الترجمة الفرنسية','الترجمة الألمانية','الترجمة الفورية','الترجمة القانونية','الترجمة الطبية','التوطين','التدقيق اللغوي','تعليم اللغات','كتابة المحتوى متعدد اللغات'],
  ['الهندسة والإنشاءات','الهندسة المدنية','الهندسة المعمارية','الهندسة الكهربائية','الهندسة الميكانيكية','الهندسة الزراعية','الهندسة الصناعية','الإشراف الهندسي','المساحة','التصميم الداخلي','إدارة مواقع البناء','السلامة المهنية','الصيانة'],
  ['الصحة والرعاية','التمريض','المختبرات الطبية','الصيدلة','العلاج الطبيعي','التغذية','الصحة العامة','الرعاية المنزلية','الإسعاف','التثقيف الصحي','إدارة المراكز الصحية','الأجهزة الطبية','الدعم النفسي غير السريري'],
  ['القانون والخدمات القانونية','الاستشارات القانونية','صياغة العقود','البحوث القانونية','الترجمة القانونية','الامتثال','الشؤون القانونية','الوساطة','التحكيم','التوثيق','قانون الشركات','الملكية الفكرية','المناقصات'],
  ['الزراعة والبيئة','الإنتاج النباتي','الإنتاج الحيواني','الري الحديث','إدارة المزارع','التصنيع الغذائي','البيئة والاستدامة','الطاقة المتجددة','الثروة السمكية','المشاتل','التسويق الزراعي','الإرشاد الزراعي','إدارة المياه'],
  ['النقل واللوجستيات','النقل البري','الشحن والتوصيل','إدارة المستودعات','سلاسل الإمداد','التخليص الجمركي','إدارة الأساطيل','النقل الدولي','خدمات التوصيل','التوزيع','المشتريات اللوجستية','التعبئة والتغليف','خدمة العملاء اللوجستية'],
  ['السياحة والضيافة','إدارة الفنادق','خدمات المطاعم','الطبخ','الإرشاد السياحي','حجوزات السفر','تنظيم الرحلات','خدمة النزلاء','إدارة الفعاليات','خدمات المقاهي','السياحة البيئية','الاستقبال','إدارة الوجهات'],
  ['الحرف والصيانة','الكهرباء المنزلية','السباكة','النجارة','الحدادة','الدهان والديكور','صيانة الأجهزة','صيانة السيارات','التكييف والتبريد','الألمنيوم والزجاج','الخياطة','التنجيد','أعمال البلاط'],
  ['الجمال والعناية','الحلاقة','تصفيف الشعر','العناية بالبشرة','التجميل','العناية بالأظافر','المكياج','العطور','العناية الشخصية','إدارة الصالونات','التدريب المهني للجمال','تصميم الأزياء','تنسيق المظهر'],
  ['الموارد البشرية والتوظيف','استقطاب المواهب','إدارة شؤون الموظفين','التدريب والتطوير','تقييم الأداء','التعويضات والمزايا','تخطيط القوى العاملة','التوظيف التقني','الإرشاد الوظيفي','إدارة الحضور','علاقات الموظفين','بناء السياسات','التأهيل الوظيفي'],
  ['خدمة العملاء والدعم','مراكز الاتصال','الدعم الفني','الدعم عبر المحادثة','إدارة الشكاوى','نجاح العملاء','إدارة الحسابات','خدمة ما بعد البيع','إدخال البيانات','المساعدة الافتراضية','إدارة الحجوزات','المتابعة الهاتفية','الدعم متعدد اللغات'],
  ['الكتابة وصناعة المحتوى','كتابة المقالات','كتابة إعلانية','كتابة تقنية','كتابة إبداعية','كتابة السيناريو','كتابة السيرة الذاتية','التدقيق والتحرير','إدارة المدونات','وصف المنتجات','كتابة المنح','البحوث والتقارير','النشر الإلكتروني'],
  ['الأمن والسلامة','السلامة المهنية','الأمن الصناعي','مكافحة الحرائق','إدارة الطوارئ','الأمن الخاص','السلامة المرورية','تقييم المخاطر','خطط الإخلاء','التدريب على السلامة','حماية المنشآت','السلامة الغذائية','السلامة البيئية'],
  ['البيع والتجارة','التجارة الإلكترونية','المتاجر التقليدية','إدارة المتاجر','المشتريات','التوريد','خدمة نقاط البيع','تسويق المنتجات','تجارة الجملة','تجارة التجزئة','إدارة المخزون','عرض المنتجات','خدمة ما بعد البيع'],
  ['الفعاليات والترفيه','تنظيم المؤتمرات','تنظيم المعارض','تنظيم حفلات','التصوير والمناسبات','التنسيق والإنتاج','الصوت والإضاءة','إدارة المسارح','الأنشطة الترفيهية','تنظيم المسابقات','إدارة الجمهور','التنشيط الميداني','العلاقات مع الرعاة'],
  ['الفنون والثقافة','الفنون التشكيلية','الموسيقى','الأداء المسرحي','الإنتاج الفني','التراث الثقافي','إدارة المعارض الفنية','الحرف الفنية','التصوير الفني','النقد الفني','التدريب الفني','الكتابة الثقافية','إدارة المؤسسات الثقافية'],
  ['العلوم والبحث','البحث العلمي','تحليل البيانات','الإحصاء','الكيمياء','الفيزياء','الأحياء','العلوم الاجتماعية','الدراسات الميدانية','إدارة المختبرات','كتابة الأبحاث','مراجعة الدراسات','الاستشارات البحثية'],
  ['المنظمات والعمل الإنساني','إدارة المشاريع الإنسانية','المتابعة والتقييم','الحماية','الأمن الغذائي','المأوى والتعافي','المياه والإصحاح','التعليم في الطوارئ','التواصل المجتمعي','جمع التبرعات','إدارة المتطوعين','كتابة المقترحات','التوثيق والتقارير'],
  ['العقارات','الوساطة العقارية','إدارة الأملاك','التسويق العقاري','التقييم العقاري','إدارة الإيجارات','خدمات المستأجرين','التطوير العقاري','التصميم الداخلي','إدارة المرافق','الصيانة العقارية','التوثيق العقاري','الاستشارات العقارية'],
  ['الرياضة واللياقة','التدريب الرياضي','اللياقة البدنية','إدارة الأندية','التحكيم الرياضي','التغذية الرياضية','الأنشطة المجتمعية','السباحة','الرياضات الفردية','الرياضات الجماعية','التأهيل الحركي','تنظيم البطولات','التسويق الرياضي'],
  ['الخدمات المنزلية','التنظيف','العناية بالحدائق','الطبخ المنزلي','رعاية الأطفال','رعاية كبار السن','الخياطة المنزلية','الصيانة المنزلية','نقل الأثاث','تنظيم المنازل','مكافحة الآفات','خدمات الضيافة','غسيل وكي الملابس'],
  ['البيانات والذكاء الاصطناعي','تحليل البيانات','هندسة البيانات','علم البيانات','تعلم الآلة','معالجة اللغة الطبيعية','الرؤية الحاسوبية','لوحات المعلومات','ذكاء الأعمال','أتمتة العمليات','حوكمة البيانات','وسم البيانات','تدريب النماذج'],
  ['العمل الحر والخدمات الرقمية','مساعد افتراضي','إدارة المتاجر الرقمية','إدارة المجتمعات','إدخال البيانات','البحث عبر الإنترنت','إعداد العروض','أتمتة الأعمال','اختبار المواقع','إدارة المحتوى','خدمات الاشتراكات','استشارات عن بعد','خدمات متنوعة']
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
  await pool.query(fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8'));
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

app.get('/api/categories', (req,res) => res.json({ categories:CATEGORY_NAMES, count:CATEGORY_NAMES.length, subcategoryCount:CATEGORY_NAMES.reduce((n,c)=>n+c.children.length,0) }));

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
  app.listen(PORT,()=>console.log(`SHAYN listening on port ${PORT}`));
}

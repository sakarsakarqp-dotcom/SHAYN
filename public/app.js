const API='/api';
let token=localStorage.getItem('shayn_token')||'';
let currentUser=null;
let cart=[];
try{cart=JSON.parse(localStorage.getItem('shayn_cart')||'[]');if(!Array.isArray(cart))cart=[];}catch{cart=[];}
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(message){const el=$('toast');if(!el)return;el.textContent=message;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2800)}
async function api(path,options={}){const headers={'Content-Type':'application/json',...(options.headers||{})};if(token)headers.Authorization='Bearer '+token;const r=await fetch(API+path,{...options,headers});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||'تعذر إكمال الطلب');return data}
function openModal(html){$('modalContent').innerHTML=html;$('modal').classList.remove('hidden')}
function closeModal(){$('modal').classList.add('hidden')}

function saveCart(){localStorage.setItem('shayn_cart',JSON.stringify(cart));updateCartCount()}
function updateCartCount(){const el=$('cartCount');if(el)el.textContent=cart.reduce((n,x)=>n+Number(x.quantity||0),0)}
function addToCart(id,title,price,currency){
 const found=cart.find(x=>x.id===Number(id));
 if(found){if(found.quantity>=50){toast('وصلت للحد الأعلى من الكمية');return}found.quantity++}
 else cart.push({id:Number(id),title:String(title),price:Number(price),currency:String(currency||'USD'),quantity:1});
 saveCart();toast('أُضيف المنتج إلى سلتك')
}
function cartView(){
 const total=cart.reduce((n,x)=>n+x.price*x.quantity,0), currency=cart[0]?.currency||'USD';
 openModal('<h2>سلة التسوق</h2>'+
 (cart.length?'<div class="cart-items">'+cart.map(x=>'<div class="cart-row"><div><b>'+esc(x.title)+'</b><small>'+x.quantity+' × '+x.price.toFixed(2)+' '+esc(x.currency)+'</small></div><button class="ghost" data-remove-cart="'+x.id+'">حذف</button></div>').join('')+'</div><p class="cart-total">الإجمالي: <b>'+total.toFixed(2)+' '+esc(currency)+'</b></p>'+
 '<form id="checkoutForm"><label>اسم المستلم<input name="buyer_name" required minlength="2" value="'+esc(currentUser?.name||'')+'"></label><label>رقم الهاتف<input name="buyer_phone" required minlength="5" type="tel"></label><label>عنوان التوصيل<textarea name="delivery_address" required minlength="5"></textarea></label><p class="form-hint">هذا طلب شراء مبدئي؛ لا يتم تحصيل أي مبلغ إلكترونياً في هذه المرحلة.</p><button class="primary">تأكيد الطلب</button></form>'
 :'<p class="empty">سلتك فارغة حالياً. تصفّح المنتجات وأضف ما يعجبك.</p>'));
 document.querySelectorAll('[data-remove-cart]').forEach(b=>b.onclick=()=>{cart=cart.filter(x=>x.id!==Number(b.dataset.removeCart));saveCart();cartView()});
 $('checkoutForm')?.addEventListener('submit',async e=>{e.preventDefault();if(!currentUser){authForm('login');return}const data=Object.fromEntries(new FormData(e.target));try{const result=await api('/orders',{method:'POST',body:JSON.stringify({...data,items:cart.map(x=>({listing_id:x.id,quantity:x.quantity}))})});cart=[];saveCart();openModal('<h2>تم تسجيل طلبك</h2><p>رقم الطلب: <b>#'+result.order.id+'</b></p><p>أُرسل الطلب إلى البائع، ويمكنك متابعة حالته من قسم طلباتي.</p><button class="primary" id="ordersAfterCheckout">عرض طلباتي</button>');$('ordersAfterCheckout').onclick=showOrders;toast('تم حفظ طلبك بنجاح')}catch(err){toast(err.message)}});
}
async function showOrders(){
 if(!currentUser){authForm('login');return}
 try{const d=await api('/orders');openModal('<h2>طلباتي</h2>'+(d.orders.length?d.orders.map(o=>'<article class="order-card"><b>طلب #'+o.id+'</b><span>'+esc(o.status)+'</span><p>'+o.items.map(i=>esc(i.title)+' × '+i.quantity).join('، ')+'</p><strong>'+Number(o.total).toFixed(2)+' '+esc(o.currency)+'</strong><small>البائع: '+esc(o.seller_name)+' · '+new Date(o.created_at).toLocaleDateString('ar')+'</small></article>').join(''):'<p class="empty">لا توجد طلبات بعد.</p>'))}catch(e){toast(e.message)}
}
async function showSellerOrders(){
 if(!currentUser){authForm('login');return}
 try{const d=await api('/seller/orders');openModal('<h2>طلبات متجري</h2>'+(d.orders.length?d.orders.map(o=>'<article class="order-card"><b>طلب #'+o.id+'</b><span>'+esc(o.status)+'</span><p>'+o.items.map(i=>esc(i.title)+' × '+i.quantity).join('، ')+'</p><strong>'+Number(o.total).toFixed(2)+' '+esc(o.currency)+'</strong><small>المستلم: '+esc(o.buyer_name)+' · '+esc(o.buyer_phone)+'</small><small>العنوان: '+esc(o.delivery_address)+'</small><label>تحديث الحالة<select data-order-status="'+o.id+'"><option value="confirmed">تأكيد الطلب</option><option value="preparing">قيد التجهيز</option><option value="shipped">تم الشحن</option><option value="completed">مكتمل</option><option value="cancelled">إلغاء</option></select></label><button class="outline" data-save-order="'+o.id+'">حفظ الحالة</button></article>').join(''):'<p class="empty">لا توجد طلبات على منتجاتك حتى الآن.</p>'));document.querySelectorAll('[data-save-order]').forEach(b=>b.onclick=async()=>{const select=document.querySelector('[data-order-status="'+b.dataset.saveOrder+'"]');try{await api('/seller/orders/'+b.dataset.saveOrder,{method:'PATCH',body:JSON.stringify({status:select.value})});toast('تم تحديث حالة الطلب');showSellerOrders()}catch(e){toast(e.message)}})}catch(e){toast(e.message)}
}

function setAuth(user){currentUser=user;token=localStorage.getItem('shayn_token')||token;$('loginBtn')?.classList.toggle('hidden',!!user);$('registerBtn')?.classList.toggle('hidden',!!user);$('logoutBtn')?.classList.toggle('hidden',!user);$('postBtn')?.classList.toggle('hidden',!user);$('admin')?.classList.toggle('hidden',!user||!['super_admin','admin','moderator'].includes(user.role));$('myOrdersBtn')?.classList.toggle('hidden',!user);$('sellerOrdersBtn')?.classList.toggle('hidden',!user);}
async function loadMe(){if(!token){setAuth(null);return}try{const d=await api('/me');setAuth(d.user);if(['super_admin','admin','moderator'].includes(d.user.role))loadAdmin()}catch{token='';localStorage.removeItem('shayn_token');setAuth(null)}}
function authForm(mode){const register=mode==='register';openModal(`<h2>${register?'إنشاء حساب جديد':'تسجيل الدخول'}</h2><form id="authForm">${register?'<label>الاسم<input name="name" required minlength="2" autocomplete="name"></label>':''}<label>البريد الإلكتروني<input name="email" type="email" required autocomplete="email"></label><label>كلمة المرور<input name="password" type="password" required minlength="${register?10:1}" autocomplete="${register?'new-password':'current-password'}"></label><button class="primary" type="submit">${register?'إنشاء الحساب':'دخول'}</button><p style="font-size:12px;text-align:center">${register?'لديك حساب؟':'ليس لديك حساب؟'} <a href="#" id="switchAuth" style="color:#087443">${register?'سجل الدخول':'أنشئ حساباً'}</a></p></form>`);$('switchAuth').onclick=e=>{e.preventDefault();authForm(register?'login':'register')};$('authForm').onsubmit=async e=>{e.preventDefault();const body=Object.fromEntries(new FormData(e.target));try{const d=await api(register?'/auth/register':'/auth/login',{method:'POST',body:JSON.stringify(body)});token=d.token;localStorage.setItem('shayn_token',token);setAuth(d.user);closeModal();toast(register?'أهلاً بك في شين':'تم تسجيل الدخول');if(['super_admin','admin','moderator'].includes(d.user.role))loadAdmin()}catch(err){toast(err.message)}}}
function listingForm(preset='market'){
 if(!currentUser){authForm('login');return}
 const business=preset==='business';
 openModal(`<h2>${business?'عرّف الناس بشركتك أو جهتك':'أضف إعلاناً جديداً'}</h2>
 <p class="form-hint">${business?'مساحة للشركات والمتاجر والمؤسسات والجمعيات والمبادرات ومقدمي الخدمات للتعريف بأنشطتهم.':'اختر نوع الإعلان المناسب حتى يظهر في القسم الصحيح.'}</p>
 <form id="listingForm">
 <label>نوع الإعلان<select name="type" id="listingType" required>
 <option value="market" ${preset==='market'?'selected':''}>منتج للبيع</option><option value="service" ${preset==='service'?'selected':''}>خدمة</option><option value="project">طلب شراء</option><option value="job">عرض أو فرصة تجارية</option><option value="business" ${business?'selected':''}>إعلان شركة أو جهة</option></select></label>
 <div id="businessFields" class="${business?'':'hidden'}">
 <label>اسم الشركة أو الجهة<input name="entity_name" maxlength="160" placeholder="اسم الشركة، المؤسسة، المتجر أو المبادرة" ${business?'required':''}></label>
 <label>نوع الجهة<select name="entity_kind"><option value="company">شركة</option><option value="store">متجر</option><option value="organization">مؤسسة / منظمة</option><option value="association">جمعية</option><option value="initiative">مبادرة / مشروع</option><option value="professional">مكتب أو نشاط مهني</option><option value="other">جهة أخرى</option></select></label>
 <label>الموقع الإلكتروني (اختياري)<input name="website" type="url" placeholder="https://example.com"></label>
 <label>رقم التواصل (اختياري)<input name="contact_phone" type="tel" placeholder="+90... أو رقم التواصل"></label>
 </div>
 <label>عنوان الإعلان<input name="title" required minlength="4" maxlength="180" placeholder="${business?'مثلاً: شركة النور للتجارة والخدمات':'ما الذي تريد عرضه؟'}"></label>
 <label>المجال أو التصنيف<input name="category" placeholder="مثلاً: تجارة عامة، تعليم، تقنية، أزياء، كتب..."></label>
 <label>نبذة وتفاصيل الإعلان<textarea name="description" required minlength="10" placeholder="${business?'عرّف بنشاط الجهة وخدماتها ومجالات عملها وما تقدمه للجمهور':'اكتب تفاصيل المنتج أو الخدمة ومميزاتها'}"></textarea></label>
 <label>رابط صورة أو شعار (اختياري)<input name="image_url" type="url" inputmode="url" placeholder="https://..."></label>
 <label>السعر (اختياري)<input name="price" type="number" min="0" step="0.01"></label>
 <label>العملة<select name="currency"><option>USD</option><option>TRY</option><option>SYP</option></select></label>
 <label>المدينة أو نطاق العمل<input name="location" placeholder="المدينة أو نطاق التغطية / عن بعد"></label>
 <button class="primary" type="submit">إرسال الإعلان للمراجعة</button></form>`);
 const typeSelect=$('listingType'), businessFields=$('businessFields'), entityName=$('listingForm').elements.entity_name, priceInput=$('listingForm').elements.price;
 const syncListingFields=()=>{const active=typeSelect.value==='business';businessFields.classList.toggle('hidden',!active);entityName.required=active;priceInput.required=typeSelect.value==='market';priceInput.previousElementSibling&&(priceInput.previousElementSibling.textContent=typeSelect.value==='market'?'السعر (مطلوب)':'السعر (اختياري)')};
 typeSelect.onchange=syncListingFields;syncListingFields();
 $('listingForm').onsubmit=async e=>{e.preventDefault();const body=Object.fromEntries(new FormData(e.target));try{await api('/listings',{method:'POST',body:JSON.stringify(body)});closeModal();toast('وصل إعلانك، وسيظهر بعد اعتماده');loadListings()}catch(err){toast(err.message)}};
}
const typeNames={job:'عرض تجاري',project:'طلب شراء',service:'خدمة',market:'منتج للبيع',business:'شركة أو جهة'};
async function loadListings(category=null){const grid=$('listingGrid');if(!grid)return;grid.innerHTML='<div class="empty">جارٍ تحميل الإعلانات...</div>';const q=new URLSearchParams();const type=$('typeFilter')?.value||'';const term=$('searchInput')?.value.trim()||'';if(type)q.set('type',type);if(category)q.set('category',category);else if(term)q.set('q',term);try{const d=await api('/listings?'+q);if(!d.listings.length){grid.innerHTML='<div class="empty">لا توجد إعلانات حالياً. كن أول من يضيف إعلاناً.</div>';return}grid.innerHTML=d.listings.map(x=>`<article class="listing product-card">${x.image_url?`<img class="product-image" src="${esc(x.image_url)}" alt="${esc(x.title)}" loading="lazy" onerror="this.remove()">`:''}<span class="kind">${esc(typeNames[x.type]||x.type)} · ${esc(x.category||'عام')}</span>${x.entity_name?'<b class="entity-name">'+esc(x.entity_name)+'</b>':''}<h3>${esc(x.title)}</h3><p>${esc(x.description).slice(0,180)}${x.description.length>180?'…':''}</p>${x.type==='business'?'<div class="entity-links">'+(x.website?'<a href="'+esc(x.website)+'" target="_blank" rel="noopener">الموقع الإلكتروني ↗</a>':'')+(x.contact_phone?'<a href="tel:'+esc(x.contact_phone)+'">اتصال: '+esc(x.contact_phone)+'</a>':'')+'</div>':''}<div class="listing-foot"><span>${esc(x.owner_name)} · ${esc(x.location||'عن بعد')}</span><b>${x.price==null?'تواصل للتفاصيل':esc(x.price)+' '+esc(x.currency||'')}</b></div><div style="display:flex;gap:8px;margin-top:12px">\${x.type==='market'&&x.price!=null?'<button class="primary" data-cart="'+x.id+'" data-title="'+esc(x.title)+'" data-price="'+Number(x.price)+'" data-currency="'+esc(x.currency||'USD')+'">أضف إلى السلة</button>':'<button class="outline" data-apply="'+x.id+'" data-owner="'+x.owner_id+'">تواصل مع البائع</button>'}<button class="ghost" data-report="\${x.id}">إبلاغ</button></div></article>`).join('');grid.querySelectorAll('[data-cart]').forEach(b=>b.onclick=()=>addToCart(b.dataset.cart,b.dataset.title,b.dataset.price,b.dataset.currency));grid.querySelectorAll('[data-apply]').forEach(b=>b.onclick=()=>applyTo(b.dataset.apply,b.dataset.owner));grid.querySelectorAll('[data-report]').forEach(b=>b.onclick=()=>reportListing(b.dataset.report))}catch(e){grid.innerHTML='<div class="empty">تعذر تحميل الإعلانات: '+esc(e.message)+'</div>'}}
function applyTo(id,owner){if(!currentUser){authForm('login');return}openModal('<h2>تواصل مع البائع</h2><form id="applyForm"><label>رسالتك<textarea name="message" required minlength="2" placeholder="اكتب استفسارك عن المنتج أو اطلب تفاصيل إضافية"></textarea></label><button class="primary">إرسال الرسالة</button></form>');$('applyForm').onsubmit=async e=>{e.preventDefault();try{await api('/messages',{method:'POST',body:JSON.stringify({recipient_id:Number(owner),listing_id:Number(id),body:e.target.message.value.trim()})});closeModal();toast('تم إرسال رسالتك إلى البائع')}catch(err){toast(err.message)}}}
function reportListing(id){if(!currentUser){authForm('login');return}openModal('<h2>الإبلاغ عن إعلان</h2><form id="reportForm"><label>سبب البلاغ<textarea name="reason" required minlength="5"></textarea></label><button class="primary">إرسال البلاغ</button></form>');$('reportForm').onsubmit=async e=>{e.preventDefault();try{await api('/reports',{method:'POST',body:JSON.stringify({...Object.fromEntries(new FormData(e.target)),listing_id:Number(id)})});closeModal();toast('وصل البلاغ إلى فريق المراجعة')}catch(err){toast(err.message)}}}
async function loadAdmin(){if(!currentUser||!['super_admin','admin','moderator'].includes(currentUser.role))return;try{const d=await api('/admin/overview');$('adminData').innerHTML=Object.entries({المستخدمون:d.users,الإعلانات:d.listings,الطلبات:d.applications,البلاغات_المفتوحة:d.open_reports}).map(([k,v])=>`<div class="stat"><b>${v}</b><span>${k.replace('_',' ')}</span></div>`).join('');const r=await api('/admin/reports');$('adminReports').innerHTML='<h3>أحدث البلاغات</h3>'+ (r.reports.length?r.reports.map(x=>`<div class="listing"><b>بلاغ #${x.id}</b><p>${esc(x.reason)}</p><small>${esc(x.reporter_name)} · ${esc(x.status)}</small><button class="outline" data-resolve="${x.id}">إغلاق البلاغ</button></div>`).join(''):'<p>لا توجد بلاغات.</p>');$('adminReports').querySelectorAll('[data-resolve]').forEach(b=>b.onclick=async()=>{try{await api('/admin/reports/'+b.dataset.resolve,{method:'PATCH',body:JSON.stringify({status:'resolved'})});loadAdmin()}catch(e){toast(e.message)}})}catch(e){toast(e.message)}}
async function loadCategories(){
 const el=$('categoryDirectory');if(!el)return;
 try{
  const d=await api('/categories');const cats=d.categories||[];
  $('categoryCount').textContent=cats.length+' قسماً · '+Number(d.totalActiveListings||0)+' إعلاناً منشوراً فعلياً';
  el.innerHTML=cats.map(c=>`<details class="category-group">
   <summary><span>${esc(c.name)}</span><small>${Number(c.listingCount||0)} إعلان</small></summary>
   <div class="category-actions"><button type="button" data-category="${esc(c.name)}">عرض كل القسم</button></div>
   <ul>${(c.children||[]).map(n=>'<li><button type="button" data-category="'+esc(n)+'">'+esc(n)+'</button></li>').join('')}</ul>
  </details>`).join('')||'<div class="empty">لا توجد تصنيفات.</div>';
  el.querySelectorAll('[data-category]').forEach(b=>b.onclick=()=>{
   const input=$('searchInput');if(input)input.value=b.dataset.category;
   if($('typeFilter'))$('typeFilter').value='';
   loadListings(b.dataset.category);$('explore')?.scrollIntoView({behavior:'smooth'});
  });
  $('categorySearch').oninput=e=>{
   const v=e.target.value.trim().toLocaleLowerCase('ar');
   el.querySelectorAll('.category-group').forEach(g=>{
    const match=!v||g.textContent.toLocaleLowerCase('ar').includes(v);
    g.classList.toggle('hidden',!match);if(v&&match)g.open=true;
   });
  };
 }catch(e){$('categoryCount').textContent='تعذر تحميل التصنيفات';el.innerHTML='<div class="empty">تعذر تحميل دليل الأقسام: '+esc(e.message)+'</div>'}
}
document.addEventListener('DOMContentLoaded',()=>{ document.querySelectorAll('.commerce-tile').forEach(tile=>tile.addEventListener('click',()=>{const input=$('searchInput');if(input)input.value=tile.dataset.query||'';if($('typeFilter'))$('typeFilter').value='';loadListings(tile.dataset.query||null)})); $('closeModal').onclick=closeModal;$('cartBtn').onclick=cartView;$('myOrdersBtn').onclick=showOrders;$('sellerOrdersBtn').onclick=showSellerOrders;updateCartCount();$('modal').onclick=e=>{if(e.target===$('modal'))closeModal()};$('loginBtn').onclick=()=>authForm('login');$('registerBtn').onclick=()=>authForm('register');$('ctaRegister').onclick=()=>authForm('register');$('logoutBtn').onclick=()=>{token='';currentUser=null;localStorage.removeItem('shayn_token');setAuth(null);toast('تم تسجيل الخروج')};$('postBtn').onclick=()=>listingForm();$('businessPostBtn').onclick=()=>listingForm('business');$('ctaBusiness').onclick=()=>listingForm('business');$('refreshBtn').onclick=loadListings;$('searchBtn').onclick=loadListings;$('typeFilter').onchange=loadListings;$('adminRefresh').onclick=loadAdmin;loadMe();loadListings();loadCategories();});

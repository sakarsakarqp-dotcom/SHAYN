# عقد واجهات الحسابات والمؤسسات — شَيْن

هذا المستند يصف واجهات API المضافة في فرع `feat/identity-organization-api-v2`. لا يعني أن الفرع مدمج أو منشور.

## المصادقة

كل المسارات عدا التسجيل والدخول تتطلب:
`Authorization: Bearer <JWT>`

## الصفات المهنية

`GET /api/me/roles` يعيد صفات المستخدم.

`PUT /api/me/roles` يستقبل:
```json
{ "roles": ["employer", "buyer"] }
```

القيم المسموحة: `job_seeker`, `employer`, `freelancer`, `service_provider`, `seller`, `buyer`. هذه صفات مهنية ولا تمنح دوراً إدارياً عاماً.

## المؤسسات

إنشاء مؤسسة:
```json
{
  "name": "اسم المؤسسة",
  "slug": "organization-slug",
  "kind": "company",
  "description": "وصف اختياري",
  "country_code": "SY"
}
```

الأنواع: `company`, `ngo`, `public_entity`, `store`, `team`, `other`.

- الشركة/الجهة تتطلب صفة `employer`.
- المتجر يتطلب `seller`.
- الفريق يتطلب `freelancer` أو `service_provider`.
- المؤسسة الجديدة تبدأ بحالة `pending` ويصبح منشئها `owner`.

## العضويات والدعوات

- `GET /api/organizations`: مؤسسات المستخدم.
- `GET /api/organizations/:id`: تفاصيل مؤسسة لعضو فعّال.
- `GET /api/organizations/:id/members`: الأعضاء للمالك أو المدير.
- `POST /api/organizations/:id/invitations`: ينشئ دعوة بدور `admin`, `recruiter`, `project_manager`, `commerce_manager`, أو `member`.
- `POST /api/organizations/invitations/accept`: يستقبل `{ "token": "..." }` ويتحقق من البريد المسجل.

رمز الدعوة الخام يظهر مرة واحدة في استجابة الإنشاء ولا يُخزّن في قاعدة البيانات؛ البريد الآلي غير مفعّل بعد. مدة الدعوة سبعة أيام.

## سجل التدقيق

`GET /api/organizations/:id/audit` متاح للمالك والمدير.

## حالات متوقعة

- `401`: لا توجد جلسة صالحة.
- `403`: لا توجد عضوية أو صلاحية كافية، أو البريد لا يطابق الدعوة.
- `409`: تعارض في الرابط أو دعوة مستخدمة/منتهية.
- `503`: ترحيل الهوية غير مطبق بعد.

## تهيئة قاعدة البيانات

بعد النسخ الاحتياطي، نفّذ:
```bash
npm run db:migrate:identity
```
ثم أعد تشغيل الخدمة. لا ينفذ التطبيق الترحيل 007 تلقائياً عند الإقلاع.

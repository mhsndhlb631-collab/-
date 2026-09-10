# نظام التشغيل التربوي — P8

**الحالة: P7 مغلقة، وتجهيز P8 وPilot قيد التنفيذ. لا تُغلق P8 قبل مرور أسبوعين تشغيليين ناجحين.**

مشروع Next.js App Router وTypeScript لإعداد البرامج وتشغيل جلساتها وتتبع تقدم الطلاب. يدعم القوالب والخطط والدفعات والمجموعات، والجلسات والحضور، والتتبع، والمحتوى والتكليفات والاختبارات، والمتابعة والحالات، وقياس أداء المربين والتقارير. تكمل P7 رحلات المسؤول والمربي والطالب بصفحات اليوم والبرنامج والتقدم، وتنقل مخصص للدور، وتغيير كلمة المرور والخروج، وتجربة عربية RTL متجاوبة ويمكن تشغيلها بلوحة المفاتيح. تعمل الطلبات عبر مستخدم PostgreSQL محدود مع RLS إجباري.

الأقفال المعتمدة:

- ملخص الأسبوع تلقائي؛ لا طابور اعتماد أسبوعي إلزامي على المسؤول.
- دور واحد للحساب؛ يستطيع المسؤول تنفيذ أعمال المربي داخل الجهة، مع حفظ المنفذ الفعلي ونسبة المسؤولية التاريخية.
- الاعتماد على جلسات Supabase الأصلية تجربة قبول مطلوبة، وليس افتراضًا مثبتًا.

## التشغيل المحلي

Node.js 24، ثم:

```sh
npm ci
npm run dev:runtime
```

افتح `http://localhost:3000`. `/health` يفحص حياة التطبيق؛ `/ready` يثبت اتصال قاعدة البيانات ودور التشغيل المحدود وأحدث migration مطلوبة.

```sh
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run smoke
npm run acceptance:p8:security
npm run acceptance:p8:load
npm run acceptance:p8:environments
npm run acceptance:p8:recovery
npm run monitor:production
```

اختبارات قاعدة البيانات تستخدم PGlite محليًا. لا تُعد بديلًا لاختبارات Supabase أو Vercel أو اتصالات PostgreSQL المجمعة.

## مستندات التنفيذ

- [الملخص الشامل للمشروع وحالة جميع المراحل](PROJECT-SUMMARY.md)
- [خطة P0 والاكتشاف](docs/p0-implementation-brief.md)
- [مخطط P0 المجمد](docs/p0-schema.md)
- [حالات المصادقة والصلاحيات](docs/p0-auth-and-scope.md)
- [تجهيز البيئات وتجربة الجلسات](docs/p0-setup.md)
- [حالة التسليم والاختبارات](docs/p0-status.md)
- [عقد P1 المجمد](docs/p1-contract.md)
- [تقرير إغلاق P1](docs/p1-status.md)
- [عقد P2 المجمد](docs/p2-contract.md)
- [تقرير إغلاق P2](docs/p2-status.md)
- [عقد P3 المجمد](docs/p3-contract.md)
- [تقرير إغلاق P3](docs/p3-status.md)
- [عقد P4 المجمد](docs/p4-contract.md)
- [تقرير إغلاق P4](docs/p4-status.md)
- [عقد تصحيح P4.1](docs/p4.1-contract.md)
- [تقرير إغلاق P4.1](docs/p4.1-status.md)
- [عقد P5 المجمد](docs/p5-contract.md)
- [تقرير إغلاق P5](docs/p5-status.md)
- [عقد P6 المجمد](docs/p6-contract.md)
- [تقرير إغلاق P6](docs/p6-status.md)
- [عقد P7 المجمد](docs/p7-contract.md)
- [تقرير إغلاق P7](docs/p7-status.md)
- [عقد P8 المجمد](docs/p8-contract.md)
- [حالة P8 الحالية](docs/p8-status.md)
- [دليل تشغيل الإنتاج](docs/runbooks/production-operations.md)
- [دليل الـPilot لأسبوعين](docs/runbooks/pilot.md)

لا تضع الأسرار في المستودع أو المحادثة. ملفات `.env*` مستبعدة من Git، باستثناء القالب الخالي من الأسرار. لا تستخدم اتصال migrations في خادم التطبيق.

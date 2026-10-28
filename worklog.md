# Worklog

---
Task ID: 1
Agent: main (Z.ai)
Task: پیاده‌سازی نرم‌افزار نودهاست (NodeHost) با معماری فدرال نودها، پروتکل شبکه‌ای NHP، ماژول‌های قابل فعال/غیرفعال، و پنل کنترل فارسی RTL

Work Log:
- بارگذاری skill ست fullstack-dev و اجرای اسکریپت init
- طراحی اسکیمای Prisma (Host/Node/ModuleDef/NodeModuleState/ModuleStorage/NhpMessage/NetDirectory/SysLog) و ساخت دو دیتابیس مستقل host-alfa.db و host-beta.db (هر نودهاست = یک دیتابیس)
- پیاده‌سازی هسته مشترک در src/core/nodehost/:
  - protocol.ts: پاکت NHP v1 (آدرس‌دهی کامل host/node، ttl، replyTo، wildcard fan-out، اعتبارسنجی dependency-free)
  - interfaces.ts: قرارداد متن‌باز INodeModule / INodeContext / IKeyValueStore / defineModule
  - modules/: چهار ماژول مرجع chat، broadcast، presence، ping
- پیاده‌سازی Kernel در mini-services/nodehost-kernel/ (bun + socket.io + Prisma):
  - kernel.ts: روتر (تحویل محلی / فوروارد HTTP)، صف store-and-forward با retry هر ۷ ثانیه تا ۶ تلاش و dead-letter، هارت‌بیت sys.hello هر ۸ ثانیه با تبادل رستر، سشن ادمین socket.io
  - runtime.ts: زمان‌اجرای ماژول با reconcile گرم (enable/disable زنده)، ایزولاسیون ctx و storage per (node,module)
  - admin.ts: کنترل‌پلین REST داخلی (/internal/*) + دیتاپلین (/ingress)
  - index.ts: دو listener (WS پورت 3003/3004 با path=/، API پورت 3013/3014) + گیت isBooted با پاسخ 503 در هنگام boot
- اجرای دو نودهاست فدرال: scripts/start-kernels.sh (alfa: 3003/3013، beta: 3004/3014)
- API پروکسی Next.js: src/app/api/nh/[...path]/route.ts → هسته آلفا
- UI تک‌صفحه‌ای فارسی RTL (Vazirmatn، شادcn/ui، next-themes، tailwind): Header + ۵ تب (داشبورد، نودها، کنسول ادمین، شبکه، پروتکل) با zustand و polling هر ۵ ثانیه
- رفع باگ‌ها:
  1. حلقهٔ تقویت پیام: صف retry پیام‌های ورودیِ در انتظار ادمین را هم می‌فرستاد → فیلتر direction:'out' + ددوپ envId
  2. import NHP_WILDCARD در kernel
  3. demoToken در دایرکتوری برنمی‌گشت → getDirectory اصلاح شد
  4. رقابت boot (پاکت قبل از اتمام boot) → گیت isBooted با 503 قابل retry
  5. خطاهای lint React Compiler (setState در effect، preserve-manual-memoization) → state خام به‌جای مقدار مشتق، گیت connected در سابسکرایپشن‌ها
  6. پروسه‌های stale بعد از bun --hot → ری‌استارت تمیز با kill بر اساس پورت
- تست سرتاسری با Agent Browser (دو تب هم‌زمان):
  - داشبورد، ساخت نود (توکن یک‌بارمصرف)، کلید ماژول زنده (تأیید در هسته)، حذف نود
  - چت دوسویه node-a1@alfa ↔ node-b1@beta از طریق HTTP واقعی بین دو هسته با دیتابیس جدا
  - پینگ بین‌سروری 9ms، broadcast فدرال (تحویل در بتا)، صف گاما: queued → 6 retry → dead-letter + بهبود خودکار بتا
  - موبایل 390px، تم تیره/روشن، lint پاک، صفر خطای مرورگر و هسته

Stage Summary:
- نرم‌افزار نودهاست با اینترفیس کامل و مقیاس‌پذیر آماده است: پروتکل NHP v1 (src/core/nodehost/protocol.ts)، قرارداد ماژول توسعه‌دهندگان (interfaces.ts + defineModule)، هسته مستقل per-server (mini-services/nodehost-kernel/)، پنل کنترل فارسی
- دو نمونهٔ فدرال روی پورت‌های 3003/3013 (آلفا) و 3004/3014 (بتا) با دیتابیس‌های جدا اجرا هستند؛ میزبان گاما به‌صورت عمدی آفلاین است برای نمایش صف
- نقطه‌های کلیدی برای توسعهٔ متن‌باز: registerModule در index.ts، /ingress برای فدراسیون، /api/nh/* برای UI، io('/?XTransformPort=<gwPort>') برای کنسول

---
Task ID: 2
Agent: main (Z.ai)
Task: مرور معماری و ریفکتور ساختاری عمیق — بدون تغییر رفتار، با هدف تمیز بودن و توسعه‌پذیری کد

Work Log:
- مرور کامل ~۴۵۰۰ خط: هسته مشترک (protocol/interfaces/modules)، کرنل (kernel/runtime/admin/store/index)، UI (۵ تب + کنسول)، اسکیمای Prisma
- فاز کرنل — تفکیک مسئولیت‌ها:
  - config.ts (جدید): همهٔ اعداد قابل‌تنظیم با نام (HEARTBEAT_MS، RETRY_SWEEP_MS، MAX_SEND_ATTEMPTS، POST_TIMEOUT_MS، سقف‌های mailbox و …) — خداحافظ اعداد جادویی پخش‌شده
  - mailbox.ts (جدید): تنها خانهٔ ماندگاری NhpMessage — رکوردسازیِ ۴ بار تکرارشده در kernel.ts به ۸ تابع معنادار تبدیل شد (recordInbound/recordOutbound/alreadyDelivered/bumpRowAttempt/markRowForwarded/markRowDead + کوئری‌های chat/broadcast/mailbox)
  - adminSocket.ts (جدید): پروتکل سیمِ سشن ادمین از kernel.ts جدا شد؛ kernel = مغز مسیریابی و بس. نام room از adminRoom() مشترک می‌شود
  - kernel.ts: postAndTrack() یک‌جا «POST + merge hello + به‌روزرسانی سلامت میزبان» را مدیریت می‌کند (forwardRemote، heartbeatOnce، retryQueued از آن استفاده می‌کنند)؛ شاخه‌های موفقیت/شکست forwardRemote یکی شد
  - runtime.ts: لاگر ماژول‌ها به log() مشترک store وصل شد (حذف کد تکراری console+sysLog)
  - admin.ts: هندلرهای if-chain به توابع کوچک تبدیل شد؛ import داینامیکِ per-request به import ایستا؛ kernel از طریق پارامتر پاس می‌شود نه mutation روی Request
- فاز هستهٔ مشترک: حذف کد مرده (rosterPayload در presence.ts)
- فاز UI — تفکیک کنسول ۸۵۷ خطی به ۷ فایل:
  - console/ConsoleTab.tsx (فرم اتصال) + ConsoleSessionView.tsx (مالک سشن) + panels/{Chat,Board,Ping,Raw}Panel.tsx + socket-context.tsx + json.ts
  - هک جهانی window.__nhSocket (۱۰ نقطه) حذف شد → ConsoleSocketContext با API رفتاری (send/emit/onNhpIn) — پنل‌ها حتی socket.io-client را import نمی‌کنند
  - page.tsx: دبل-پولینگ رفع شد (یک تایمر ۵ثانیه‌ای به‌جای دو تا)، کد مرده حذف، منطق «رفتن به کنسول نود محلی» به openConsoleForLocalNode() در store منتقل شد
  - connectableHosts() تکراری در ConsoleTab حذف و از store استفاده شد؛ نوع مشترک SendFn/WireEnvelope در types.ts
- پاکسازی‌های دیگر:
  - scaffold «Hello world» (src/app/api/route.ts) حذف شد
  - start-kernels.sh به مسیرهای نسبی (نسبت به خود اسکریپت) تبدیل شد — قابل‌اجرا در هر checkout و کانتینر بدون ویرایش
  - @types/bun اضافه شد؛ ignoreBuildErrors از next.config.ts حذف شد — از این به بعد خطای تایپ = شکست build
  - خطاهای تایپ پنهانِ قدیمی رفع شد (NodesTab token/version، MailRow.envelope، DirectoryEntry.demoToken، narrowing سیگنال‌های process در bun-types)
- تست دود کامل (تأیید حفظ رفتار):
  - بوت دو کرنل فدرال + تبادل رستر (دایرکتوری هر دو طرف کامل)
  - ارسال چت بین‌میزبانی alfa→beta از /ingress → تحویل به صندوق node-b1 ✓
  - میزبان گاما: outcome=queued + لاگ «unreachable» ✓ (store-and-forward)
  - پاکت نامعتبر → 422 ✓
  - tests/smoke-admin-socket.ts (جدید): admin:hello + nhp:send + chat:history + mailbox:list ✓
  - tsc پاک، eslint پاک، next build موفق، UI + پروکسی /api/nh/bootstrap تست شد

Stage Summary:
- رفتار بیرونی تغییر نکرده؛ ساختار داخلی کاملاً ماژولار شد: routing (kernel) / persistence (mailbox) / wire-admin (adminSocket) / tuning (config) — هر کدام یک فایل مستقل
- ایمنی آینده: type-check اجباری در build، تست دود سوکت در tests/، ثابت‌های نام‌دار
- نقشهٔ توسعهٔ بعدی آسان‌تر شد: ماژول جدید فقط defineModule + registerModule؛ پنل جدید فقط یک فایل در panels/

---
Task ID: 3
Agent: main (Z.ai)
Task: سخت‌سازی اینترفیس ارتباطی میان نودها طبق بازبینی معماری — احراز هویت /ingress، backoff نمایی صف retry، موازی‌سازی فدرال، و API درخواست/پاسخ همبسته برای ماژول‌ها

Work Log:
- احراز هویت دیتاپلین (اختیاری و بدون شکستن استقرار فعلی):
  - متغیر محیطی NHP_LINK_SECRET در ENV (store.ts) — وقتی تنظیم شده باشد، /ingress فقط با هدر «Authorization: Bearer <secret>» می‌پذیرد (401 در غیر این صورت)؛ بدون آن، حالت باز قبلی حفظ می‌شود
  - مقایسهٔ constant-time با timingSafeEqual (node:crypto) در federation.ts؛ خروجی‌های کرنل هم هدر را فقط وقتی راز تنظیم است می‌فرستند
  - start-kernels.sh مقدار NHP_LINK_SECRET را (در صورت export) به هر دو کرنل می‌رساند
- استخراج federation.ts از kernel.ts:
  - transport (postEnvelope/postAndTrack)، حضور (heartbeatOnce/mergeHello/selfHello) و بازیابی (retryQueued) الان در یک ماژول مستقل‌اند — «تنها جای دنبال‌کردن زنده‌بودن میزبان‌ها»
  - هارت‌بیت و فوروارد wildcard حالا با Promise.all موازی‌اند (قبلاً حلقهٔ ترتیبی)
- backoff نمایی برای صف ارسال:
  - delay = RETRY_SWEEP_MS × 2^(attempts−1) با سقف MAX_BACKOFF_MS=120s (config.ts) — بدون هیچ تغییری در اسکیمای Prisma (سازگار با auto-pull داکر)
  - وضعیت backoff در حافظهٔ Federation نگه‌داری می‌شود (rowId → nextAttemptAt)؛ restart فقط یک تلاش فوری برای صف موجود معنا می‌دهد
  - settle() در همهٔ مسیرهای خروج از صف (forwarded/dead) فراموشی ردیف را تضمین می‌کند
- مکانیزم request/response همبسته (RPC ماژول‌ها):
  - INodeContext.request(to, module, type, payload, {timeoutMs}) در interfaces.ts — پاسخ ماژول مقصد از طریق replyTo به فراخوان تحویل می‌شود (پیش‌فرض ۱۰ ثانیه، REQUEST_TIMEOUT_MS)
  - kernel: pending map + resolvePending در route()؛ پاکت پاسخ علاوه بر حل‌شدنِ درخواست، مسیر عادی تحویل (mailbox + dispatch) را هم طی می‌کند
  - پاک‌سازی تایمرهای pending در shutdown()
- تست‌های دود جدید (خودبسنده، با بوت کرنل واقعی):
  - tests/smoke-ingress.ts: ماتریس احراز هویت (401×2، 400، 422)، hello مجاز 200 + رستر، چت محلی با ادمین آنلاین هر دو طرف + رسیدن sys.ack همبسته به سوکت فرستنده، صف‌شدن پیام میزبان gama
  - tests/smoke-federation.ts: دو کرنل با راز مشترک — رد 401 روی beta، merge hello → «alfa online» در دایرکتوری beta، چت بین‌میزبانی alfa→node-b1 با payload سالم فارسی
- رفع جانبی: باگ خروج زودهنگام start-kernels.sh (گسترش آرایهٔ خالی SECRET_ENV) → پاس‌دادن همیشگی NHP_LINK_SECRET (خالی = حالت باز)
- README: مستندات امنیت لینک، backoff نمایی، ctx.request و federation.ts در ساختار پروژه

Stage Summary:
- رفتار حافظه‌ای قبلی کاملاً حفظ شد (تمام تست‌های دود قبلی پاس) و سه ضعف اینترفیس برطرف شد: ingress بدون احراز هویت، retry ثابت بدون backoff، حلقه‌های ترتیبی فدرال
- نتیجهٔ تست: tsc پاک، eslint پاک، ALL INGRESS TESTS PASSED، ALL FEDERATION TESTS PASSED
- کرنل الان سه لایهٔ مجاز دارد: routing (kernel) / inter-host (federation) / persistence (mailbox) — افزودن ترنسپورت یا همسایگی جدید فقط تغییر در federation.ts است

---
Task ID: 4
Agent: main (Z.ai)
Task: لایهٔ چندکاربری (Multi-Tenant) — ثبت‌نام کاربر، نود شخصی، کلید ماژول، سقف نود ادمین (پیش‌فرض ۵۰)

Work Log:
- اسکیما: مدل‌های User / Session / Setting + ستون Node.ownerId (nullable، SetNull) — سازگار با auto-pull داکر (push افزایشی، بدون از دست دادن داده)
- auth.ts: رمز scrypt (بدون وابستگی خارجی)، نشست کوکی httpOnly ۳۰ روزه که دیتابیس فقط sha256 توکنش را دارد، قاعدهٔ «نخستین ثبت‌نام = ادمین» برای بوت‌استرپ نمونهٔ تازه
- API: /api/auth/{register,login,logout,me} + /api/admin/users + /api/admin/users/[id] (تعلیق/ارتقا با محافظت آخرین-ادمین و ممنوعیت تغییر خود) + /api/admin/settings (maxNodes)
- بازنویسی پروکسی /api/nh/[...path] به «یک در، یک نگهبان»:
  - bootstrap سانیتایز per-viewer (src/lib/tenant.ts): مهمان = فقط دمو بدون توکن/لاگ؛ کاربر = دمو + مالکیت خودش؛ ادمین = کامل ولی باز هم بدون توکن نودهای کاربران
  - جهش‌ها: نشست الزامی + مالکیت نود + سهمیهٔ maxNodes روی ساخت نود + گیت ادمین روی مدیریت میزبان‌های راه‌دور
  - passthrough حالا بدنهٔ درخواست را به کرنل می‌رساند (باگ 422 ماژول‌تاگل در تست کشف و رفع شد)
- کرنل: تنها تغییر = createNode مقدار opaque ownerId را از لایهٔ وب می‌پذیرد (کرنل user-agnostic می‌ماند)
- UI: AuthGate (ورود/ثبت‌نام RTL با راهنمای «نخستین کاربر ادمین می‌شود»)، چیپ کاربر + خروج در Header، تب «ادمین سیستم» فقط برای ادمین، AdminTab (تنظیم maxNodes + جدول کاربران با تعلیق/ارتقا)، نمای فقط‌خواندنی شبکه برای کاربر عادی، بج «مالک» و «سهمیه» در NodesTab
- تست: tests/smoke-multitenant.sh (۲۰ چک: اولین-ادمین، مالکیت، سهمیهٔ ۵۰ قابل تغییر، تعلیق=ابطال نشست، سانیتایز، خروج) — ALL PASSED؛ تست‌های قبلی smoke-ingress و smoke-federation هم ALL PASSED (اینترفیس NHP دست‌نخورده)
- E2E مرورگر: ثبت‌نام ادمین ← ساخت نود ← دیالوگ توکن یک‌بارمصرف ← تاگل ماژول ← پنل ادمین ← خروج ← ثبت‌نام کاربر دوم ← ایزولاسیون (عدم دیدن نود ادمین، تب ادمین و فرم میزبان) — همه تأیید شد
- زیرساخت: scripts/start-web.sh (وب production با الگوی اسپاون مطابق کرنل) و next.config turbopack.root برای checkout داخل workspace تو در تو

Stage Summary:
- مسیر کامل «ثبت‌نام ← نود شخصی ← فعال/غیرفعال ماژول ← کار روی فدراسیون» با کنترل ادمین روی تعداد نودها (پیش‌فرض ۵۰) فعال است
- مرز امنیتی: هویت فقط در لایهٔ وب؛ کرنل و /ingress و قرارداد ماژول‌ها بدون تغییر برای توسعه‌دهندگان بیرونی

---
Task ID: 5
Agent: main (Z.ai)
Task: اتصال مخزن گیت‌هاب و برقراری جریان کاری «تغییر → پوش → سینک داکر» برای اعمال تغییرات بعدی

Work Log:
- کلون مخزن pmohpro-wq/nodehost به محیط کاری و بررسی ساختار (۴ تسک قبلی ورکلاگ موجود و سالم)
- تنظیم ریموت origin با توکن دسترسی شخصی (PAT) برای پوش‌های بعدی بدون ورود مجدد
- ذخیرهٔ اطلاعات گیت‌هاب (آدرس مخزن + توکن + دستورات آماده) در local-worklog.md — فایل محلی git-ignored (الگوی local-* در .gitignore)
- ⚠️ توکن عمداً در این ورکلاگ (فایل tracked) کامیت نشد: مخزن Public است و کامیت توکن یعنی افشای عمومی + ابطال خودکار توسط secret-scanning گیت‌هاب که سینک داکر را هم می‌شکند
- مستندسازی جریان استقرار در local-worklog.md: پروژه روی داکر اجرا می‌شود و هر پوش به main به‌صورت خودکار به داکر منتقل می‌شود (commit + push = استقرار)

Stage Summary:
- جریان کاری برقرار است: هر تغییر آینده ابتدا commit و سپس push به main می‌شود و داکر خودکار دریافت می‌کند
- اعتبارنامه‌ها برای جلسات بعدی در local-worklog.md (محلی، امن) در دسترس‌اند
- قانون ایمنی پوش: پیش از هر پوش، type-check و lint سالم باشد — پوش مستقیماً استقرار است

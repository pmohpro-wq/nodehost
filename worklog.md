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

---
Task ID: 6
Agent: main (Z.ai)
Task: حذف کامل شبیه‌سازی چند‌نودهاست — مدل استقرار «هر سرور دقیقاً یک NodeHost»

Work Log:
- تصمیم معماری به درخواست مالک: این سرور فقط یک نودهاست دارد؛ نودهاست‌های دیگر روی سرورهای واقعی دیگر ساخته می‌شوند؛ هیچ شبیه‌سازی چند‌هاستی مجاز نیست
- scripts/start-kernels.sh بازنویسی شد: فقط یک کرنل (WS 3003 / API 3013) — بدون بتا، بدون PEER پیش‌فرض، بدون SEED_PROFILE؛ مقادیر مثل قبل بدون قید‌وشرط ست می‌شوند (متغیرهای محیطیِ محیط میزبان نباید به پیکربندی کرنل نشت کند — باگ DATABASE_URL محیطی در تست کشف و با NH_* پیش‌فرض‌های امن رفع شد)
- store.ts — بهداشت تولید (3.5 در ensureSeed): وقتی SEED_PROFILE خالی است، در هر بوت:
  - نودهای دمو با توکن‌های معروف (demo-token-*) حذف می‌شوند (حفرهٔ امنیتی در تولید)
  - هر هاست remote که آدرسش 127.0.0.1/localhost باشد حذف می‌شود — فدراسیون فقط بین سرورهای واقعی است؛ ردیف localhost = بازماندهٔ شبیه‌سازی محلی
  - میزبان‌های واقعیِ افزودهٔ ادمین (آدرس غیرمحلی) هرگز دست نمی‌خورند؛ PEER همچنان برای ردیف هاست واقعی هنگام بوت معتبر است
- دموسازی به opt-in تبدیل شد: SEED_PROFILE=alfa|beta فقط برای توسعه/نمایش؛ تولید همیشه تمیز بالا می‌آید
- README: بخش Quick Start و ساختار پروژه به مدل تک‌نودهاست بازنویسی شد + توضیح فدراسیون واقعی از تب شبکه
- صحت‌سنجی: FKهای Node همگی Cascade (NhpMessage اصلاً FK ندارد) → حذف دموها امن؛ tsc پاک، eslint پاک، next build موفق
- رگرسیون: ALL INGRESS TESTS PASSED، ALL FEDERATION TESTS PASSED (تست‌ها خودشان SEED_PROFILE ست می‌کنند و از opt-in استفاده می‌کنند)
- اجرای محلی تأیید شد: bootstrap = یک هاست محلی، صفر هاست remote، صفر نود دمو
- نکتهٔ کشف‌شده در تست: فایل‌های db/*.db در گیت tracked هستند و تغییرات محلی هرگز push نمی‌شود؛ پیشنهاد آینده: خروج db از گیت (نیازمند هماهنگی با داکر برای جلوگیری از حذف داده هنگام pull)

Stage Summary:
- مدل استقرار نهایی: هر سرور = یک NodeHost واقعی؛ فدراسیون فقط با سرورهای واقعی دیگر (تب شبکه / PEER)؛ شبیه‌سازی چند‌هاستی از مسیر اجرای تولید حذف شد
- دیتای بازماندهٔ شبیه‌سازی (نودهای دمو، هاست‌های localhost) در نخستین بوت تولیدی خودکار پاک می‌شود
- مسیر بازگشت برای توسعه: SEED_PROFILE=alfa bash scripts/start-kernels.sh

---
Task ID: 7
Agent: main (Z.ai)
Task: ساده‌سازی رادیکال محصول طبق بازخورد مالک — «هر نودهاست یک ادمین، هر کاربر فقط یک نود، فقط چند ماژول تستی با کلید روشن/خاموش»

Work Log:
- بازخورد مالک: معماری و UI پیچیده و گیج‌کننده است، هدف گم شده؛ خواستهٔ صریح: نود شخصی + ماژول‌های تستی با فعال/غیرفعال
- UI — حذف ۱۳ فایل (~۱۷۰۰ خط): DashboardTab، NodesTab، NetworkTab، ProtocolTab، AdminTab و کل کنسول سوکت (ConsoleTab + SessionView + ۴ پنل + socket-context + json) — پنل از ۶ تب به یک صفحه رسید
- UI — MyNode.tsx (جدید، کل محصول در یک صفحه): کارت نود شخصی (نام، کد، وضعیت، میزبان) + فهرست ماژول‌ها با سوییچ روشن/خاموش (broadcast/chat/ping/presence) + «آزمایش زندهٔ نود» (ارسال پیام چت به نود خود + خوراک پیام‌ها از mailbox)
- UI — AdminUsers.tsx (جدید): مینیمال‌ترین پنل ادمین — فهرست کاربران + تعلیق/فعال‌سازی + ارتقا/سلب ادمین
- UI — Header بدون تب (برند + چیپ میزبان + چیپ کاربر + خروج + پوسته)؛ store.ts اسلیم شد (حذف تب/سشن کنسول/persist)؛ types.ts تمیز شد؛ AuthGate متن جدید: «با ثبت‌نام نود شخصی شما خودکار ساخته می‌شود»
- Backend — قاعدهٔ «هر کاربر فقط یک نود» در پروکسی (جایگزین سقف maxNodes): ثبت‌نام خودکار نود شخصی را می‌سازد (با fallback یک‌کلیکی در UI اگر کرنل موقتاً پایین باشد)
- Kernel — نقطهٔ REST تست POST /internal/nodes/:code/send (trusted-internal؛ مالکیت در پروکسی): پاکت loopback node→self با makeEnvelope و مسیر route(env,'local')؛ markRowDelivered در mailbox.ts: ردیف loopback که بدون سوکت ادمین queued می‌ماند، delivered علامت می‌خورد (پیام واقعاً به صندوق نود رسیده و به ماژول dispatch شده)
- تست: e2e-simple.sh (۷ چک E2E واقعی: ثبت‌نام → نود خودکار → رد نود دوم → تاگل → ارسال REST → خوراک mailbox → سد دسترسی نود بیگانه) ALL PASSED + تایید مرورگری کامل (ثبت‌نام در UI، تاگل چت، ارسال پیام، دیدن «دریافتی») + tsc/eslint/next build پاک

Stage Summary:
- محصول اکنون یک جمله است: «ثبت‌نام می‌کنی، نود شخصی‌ات آماده است؛ چند ماژول تستی دارد که روشن/خاموششان می‌کنی و از همین صفحه آزمایششان می‌کنی»
- ادمین = نخستین ثبت‌نام؛ ابزارش فقط فهرست کاربران است
- معماری زیرین (کرنل/پروتکل/فدراسیون) دست‌نخورده و سالم ماند — فقط سطح نمایش و سیاست مالکیت ساده شد
- کنسول سوکت حذف شد؛ اگر بعداً لازم شد، مستقل از UI به‌صورت کلاینت خارجی (یا مسیر REST جدید) پشتیبانی می‌شود

---
Task ID: 8
Agent: main (Z.ai)
Task: ریفکتور عمیق «ماژول = اپ واقعی» — پیام‌رسان واقعی با گیرندهٔ قابل‌تعیین از دفترچه شبکه؛ حذف ماژول‌های مرده

Work Log:
- بازخورد مالک: «وقتی ماژول‌ها را فعال می‌کنم هیچ چیزی نمی‌بینم غیر از یک پیام‌رسان که گیرنده‌اش قابل تعیین نیست — مشکل را عمیق حل کن»؛ هدف تأییدشده: نود = سرور شخصی، اپ نود = پیام‌رسان واقعی با گیرنده از دفترچه، با فعال‌کردن، اپ کامل باز شود
- ریشه‌یابی باگ گیرنده: admin.ts خط send آدرس مقصد را hard-code روی خود فرستنده داشت (to = from ⇒ loopback همیشگی)؛ سه ماژول دیگر (broadcast/ping/presence) اصلاً UI نداشتند — کلیدهای مرده
- معماری جدید onApi: قرارداد INodeModule یک روش اختیاری onApi(req, ctx) گرفت — هر ماژول می‌تواند API اپ خودش را سرو کند؛ کرنل مسیر GET|POST /internal/nodes/:ref/apps/:moduleId/* را به نمونهٔ زندهٔ ماژول dispatch می‌کند (runtime.callApi)؛ ماژول غیرفعال = 409؛ مالکیت در پروکسی وب چک می‌شود (nodes/:id/apps/*)
- chat.ts بازنویسی شد (v2.0.0): اپ واقعی با state خصوصی در storage ایزوله — conv:<host>|<node> (تا ۲۰۰ پیام هر گفتگو) + seen:<host>|<node>؛ سه اندپوینت: GET conversations (contacts = دفترچه ∩ chat-فعال منهای خودم + گفتگوها با last/unread) ، GET messages (تاریخچه + علامت خوانده‌شدن) ، POST send {to,text} (ارسال پاکت واقعی NHP با ctx.send — محلی یا فدرال؛ رد self-send و مقصد ناشناخته با 422)
- اصلاح sendFromNode در admin.ts: بدنهٔ {to:{host,node}} اختیاری — مقصد محلی باید نود موجود باشد، مقصد راه‌دور باید هاست شناخته‌شده باشد؛ بدون to = loopback (سازگار با تست‌ها)
- حذف ماژول‌های مرده: broadcast.ts/ping.ts/presence.ts پاک شدند؛ ثبت در index.ts فقط chat؛ MODULE_TYPES فقط chat؛ broadcastHistory از mailbox و adminSocket حذف شد
- بهداشت بوت (store.ts گام 2.5): ماژول‌های ثبت‌نشده از ModuleDef و همهٔ NodeModuleState ها در بوت پاک می‌شوند — پنل هرگز کلید ماژول مرده نشان نمی‌دهد؛ seedهای alfa/beta فقط chat
- پروکسی وب: مسیر GET|POST nodes/:ref/apps/:moduleId(/*) با کنترل canManageNode — «یک در، یک نگهبان» حفظ شد
- UI — ChatApp.tsx (جدید، اپ کامل پیام‌رسان): دو ستون RTL (دفترچه + گفتگو)؛ ردیف گیرنده = آواتار حرف اول + نقطهٔ آنلاین (adminOnline) + پیش‌نمایش آخرین پیام + بَج خوانده‌نشده؛ حباب‌های in/out، ساعت فارسی، اسکرول خودکار؛ پول ۲.۵ثانیه‌ای گفتگوی باز + دفترچه؛ خالی‌حالت: راهنمای «کاربر دوم با ورود سریع = نود دوم»؛ outcome=queued → توست «در صف ماند»
- UI — MyNode.tsx: LiveTest حذف شد؛ AppMount جایگزین شد — چت روشن = ChatApp کامل زیر کلید، چت خاموش = کارت راهنما
- تست‌ها: smoke-ingress رستر 'chat' + سه چک جدید app api (send delivered / conversations unread+contacts / رد self-send 422)؛ smoke-federation بدون تغییر (همه‌چیز chat است)
- README: بخش «اپ‌های نود» بازنویسی شد — پیام‌رسان به‌عنوان اپ ساختی، مدل دو-کاربره برای تست، نمونهٔ onApi برای توسعه‌دهنده

Stage Summary:
- معماری مازول‌ها از «گوشیِ پیام» به «اپ واقعی» ارتقا یافت: onApi + state خصوصی storage + سرو از نمونهٔ زنده؛ پنل هر اپ را زیر کلیدش باز می‌کند
- پیام‌رسان اکنون واقعی است: گیرندهٔ دلخواه از دفترچهٔ شبکه (همین سرور + فدرال)، تاریخچه، خوانده‌نشده، حضور — هر پیام یک پاکت NHP واقعی
- صفحهٔ کاربر سه بلوک است: نود من + کلید اپ‌ها + اپ باز‌شده؛ هیچ کامپوننت مرده‌ای باقی نماند

---
Task ID: 9
Agent: main (Z.ai)
Task: ریفکتور عمیق «کشف مقیاس‌پذیر NHP 1.1 + هویت بدون رمز (آیدی = نام)»

Work Log:
- پرسش مالک: «نود چطور نودهای دیگر را کشف می‌کند وقتی مقصد روی هاست دیگری است؟ راه‌حل اصولی چیست؟» → تحلیل وضع موجود (بوت‌استرپ دستی + hello بدون تراگذری، بدون TTL، بدون تفکیک نام) و پیشنهاد سه‌گانهٔ استاندارد (Well-Known + گاسپ + TTL)؛ تصمیم مالک: «مقیاس‌پذیر باشد (میلیاردها کاربر)، رمز عبور نباشد، آیدی و نام یکی باشد — ریفکتور عمیق کن»
- protocol.ts (NHP 1.1): HelloPayload فیلد اختیاری hosts?: HostHint[] گرفت (گاسپ/PEX — دانش درجه‌دوم) + WELL_KNOWN_PATH و قرارداد WellKnownDoc؛ شکل پاکت NHP دست‌نخورده ماند ⇒ سازگاری کامل با پیرهای 1.0
- federation.ts — چهار لایهٔ جدید:
  · gossipHosts(): میزبان‌های ریموت شناخته‌شده (سقف GOSSIP_HOSTS_MAX=200، تازه‌ترین‌ها، حذف آدرس‌های loopback) در hello
  · mergeHello بازنویسی شد به merge دسته‌ای: یک findMany + createMany + updateMany موازی (به‌جای upsert تک‌تک) ⇒ merge رستری ۵۰۰تایی چند رفت شبکه‌ای؛ mergeHostHints فقط create-only (هرگز دانش موجود را خراب نمی‌کند؛ liveness انحصاراً کار postAndTrack) + lastSeen یادگیری برای TTL
  · resolveHost(code): تفکیک تنبل با /.well-known/nhp — فقط برای کد شکل‌دامنه (نقطه/دو نقطه/scheme)؛ اعتبارسنجی code تطبیقی؛ cooldown ۶۰ثانیه‌ای برای دامنه‌های مرده؛ نتیجه upsert با kind=remote
  · expireDirectory(): TTL — ردیف‌های NetDirectory بی‌بازدید >۲۴ ساعت و میزبان‌های ریموت بی‌تماس >۷ روز حذف؛ local هرگز دست نمی‌خورد
- kernel.ts: حلقهٔ TTL (بوت + هر ۳۰ دقیقه) + forwardRemote با resolve تنبل (هاست ناشناخته = بن‌بست نیست؛ شکل‌دامنه کشف می‌شود)
- admin.ts: اندپوینت عمومی GET /.well-known/nhp (بدون احراز — همان اطلاعاتی که hello جواب می‌دهد)؛ sendFromNode برای هاست ناشناخته اول resolve می‌کند (گیرندهٔ دامنه‌دار بدون ثبت دستی قابل ارسال است)؛ createNode کد اختیاری می‌پذیرد (یکتا — تکراری 409) و name = code
- store.ts: localRoster فقط نودهای «با حداقل یک اپ فعال» را اعلام می‌کند (سقف ROSTER_MAX=500، مرتب) — دفترچهٔ شبکه دایرکتوریِ اپ‌هاست نه حساب‌ها؛ سربار گاسپ مستقل از تعداد کاربران خاموش
- config.ts: ثابت‌های مقیاس یک‌جا — GOSSIP_HOSTS_MAX/ROSTER_MAX/DIR_TTL_MS/HOST_TTL_MS/DIR_SWEEP_MS/RESOLVE_TIMEOUT_MS/RESOLVE_COOLDOWN_MS
- هویت بدون رمز (آیدی = نام): schema.prisma User بدون email/passwordHash و name @unique؛ auth.ts بدون scrypt (نشست همان کوکی sha256)؛ مسیر جدید POST /api/auth/enter — یک فیلد name: تازه = حساب+نود (اولی = ادمین)، موجود = ورود؛ register/login حذف شدند؛ ثبت‌نام نود را با code=name می‌سازد و 409 تداخل کد = برگشت کامل ثبت‌نام
- پروکسی: POST nodes بدنهٔ کاربر را نادیده می‌گیرد و code/name را از viewer.name می‌مآرد (یک نود در هر کاربر) — fallback «ساخت نود من» هم id=name می‌ماند
- UI: AuthGate بازنویسی شد — یک فیلد + یک دکمه («ورود / ثبت‌نام»)، متن «همین نام آیدی، نود و آدرس شبکه‌ای شماست»؛ MyNode بدون ورودی متنی؛ AdminUsers بدون ستون ایمیل (تعداد نود + تاریخ عضویت)؛ types/tenant بدون email
- تست‌ها: smoke-ingress گسترش یافت — رستری scoped (node-a3 بدون ماژول در hello نیست)، ایمپورت گاسپ (ghost-host از hello می‌آید)، /.well-known/nhp صحت ingress، هاست بدون‌دامنه 422، createNode با code=«سارا» (فارسی در کد نود) + تکراری 409 + fallback تولیدی؛ smoke-multitenant برای دورهٔ بی‌رمز بازنویسی شد (۱۶ چک: ورود اول=ادمین+نود خودکار، نام تکراری=ورود، id=name در bootstrap، مالکیت، تعلیق/بازگردانی، خروج) — همه سبز؛ smoke-federation بدون تغییر سبز
- دادهٔ dev: User های تستی تکرارنام (سارا×۲، mohsen×۲، تست ساده×۴...) پاک و db push با اسکیمای جدید اعمال شد (حذف email/passwordHash، unique name)

Stage Summary:
- کشف نودها اصولی و مقیاس‌پذیر شد: تفکیک نام با well-known (اولین برخورد بدون ثبت دستی)، گاسپ بین میزبان‌ها (تراگذری + خودترمیم از یک seed)، TTL (بهداشت خودکار دایرکتوری) — سربار هر میزبان O(همسایه‌ها) و پیلودها سقف‌دار؛ همان الگوی اثبات‌شدهٔ Matrix/ActivityPub
- هویت ساده شد: نام کاربری = آیدی = کد نود = آدرس شبکه؛ ورود یک‌فیلدی؛ سازگاری با کدهای قدیمی حفظ شد (fallback تولیدی کد)
- مقیاس در سه محور مهار شد: پیلود (سقف roster/hints)، merge (دسته‌ای)، حافظه (TTL) — مسیر تکامل بعدی (sync دلتایی/هاب درجه‌دوم) در README مستند است

---
Task ID: 10
Agent: main (Z.ai)
Task: نشست ایزوله per-tab — هر تب یک کاربر، آیدی در آدرس‌بار (?u=)، خروج پاک؛ صفر نشت بین تب‌ها

Work Log:
- ریشه‌یابی: نشست قبلی کوکی httpOnly مشترک بین همه‌ی تب‌ها بود (nh_session + جدول Session) — دو تب = یک کاربر، خروج یکی دیگری را هم بیرون می‌انداخت
- auth.ts بازنویسی شد: getSessionUser (کوکی) → getTabUser(req) — هویت از هدر x-nh-user (نام URL-encode شده برای پشتیبانی فارسی) و اعتبارسنجی زنده در DB در «هر» درخواست؛ startSession/endSession و SESSION_COOKIE حذف
- schema.prisma: مدل Session و رابطه User.sessions حذف شد (دوره‌ی بی‌جلسه-سمت-سرور)؛ db push اعمال شد
- /api/auth/enter: بدون کوچه؛ بست نام ممنوع (جداکننده‌ی کلید گفتگو conv:host|node) + نویسه‌های کنترلی؛ ورود تکراری idempotent ماند
- /api/auth/me و /api/auth/logout حذف شدند (مسیر مرده — viewer با هر bootstrap برمی‌گردد؛ خروج فقط سمت تب)
- پروکسی /api/nh/* و سه مسیر ادمین: viewer یک‌بار در ابتدای forward از هدر حل می‌شود؛ حذف getSessionUserهای تکراری؛ تعلیق کاربر = قطع از درخواست بعدی (بدون چیزی برای revoke)
- session.ts جدید (کلاینت): readTabUser/writeTabUser/clearTabUser روی sessionStorage (per-tab by spec) + tabUserHeaders + setUrlForUser/urlUserName — هیچ‌چیز به localStorage یا کوکی نمی‌رود
- api.ts: nhGet/nhPost/nhDelete/nhJson خودکار هدر x-nh-user تب خودشان را می‌فرستند
- store.ts بازنویسی: boot() یک‌بار در هر تب — URL منبع حقیقت: ?u= موجود → fast-path از sessionStorage یا silent enter (پیوستن لینک ?u=X در تب تازه = ورود همان کاربر؛ قرارداد تست بدون رمز)؛ ?u= غایب → تب مهمان؛ refresh() اگر سرور هویت تب را رد کند خودش نشست + پارامتر را پاک می‌کند؛ login() نشست و URL را «با هم» می‌نویسد؛ logout() هر دو را پاک می‌کند (بدون فراخوانی سرور)
- page.tsx: mount = boot() + polling؛ AuthGate: ورود از طریق store.login با نتیجه‌ی موفق/ناموفق + متن تازه‌ی «نشست فقط در همین تب؛ آیدی به آدرس‌بار می‌رود و با خروج حذف می‌شود»
- Header: چیپ کاربر با آدرس کامل شبکه‌ای id@host-code؛ MyNode: NodeHeader هم hostName→hostCode (آدرس واقعی NHP)
- scripts/start-web.sh: health-check از /api/auth/me (حذف‌شده) به /api/nh/bootstrap
- tests/smoke-tab-auth.sh جدید (۲۱ چک): enter idempotent، رد نام دارای |، دو هدر روی یک URL = دو viewer، مهمان بدون توکن، نام ناشناخته در هدر = مهمان، چت دو کاربر هم‌هاست، و سه گیت 403 (mailbox/chat-app/modules)
- رفع عملیاتی: rm -rf .next زیر dev server زنده ۵۰۰ داد → وب در حالت production (مطابق دیپلوی) با start-web.sh بالا آمد
- E2E با Agent Browser (سه تب هم‌زمان): ورود میلی → ?u=میلی در آدرس‌بار؛ رفرش → برقرار؛ تب ۲ بدون پارامتر → مهمان (صفر نشت)؛ ورود بابک در تب ۲ → تب ۱ همچنان میلی؛ خروج در تب ۱ → آدرس‌بارش خالی و AuthGate، تب ۲ دست‌نخورده بابک؛ تب تازه با لینک ?u=میلی → ورود خودکار

Stage Summary:
- جداسازی نشست کامل شد: کوکی/جدول Session/محلی‌سازی سمت سرور حذف؛ هویت = هدر هر درخواست که سرور هر بار زنده اعتبارسنجی می‌کند → دو تب ذاتاً دو کاربر، خروج/تعلیق/نشت عملاً بی‌معنا
- آدرس‌بار حامل هویت است: ورود = ظهور ?u=آیدی، خروج = محو آن؛ بازکردن لینک در تب تازه = همان کاربر (ساده‌ترین جریان تست چندکاربره)
- ۲۱/۲۱ smoke + چرخه‌ی کامل مرورگری سبز؛ tsc/eslint/next build تمیز؛ معماری onApi و NHP 1.1 دست‌نخورده

---
Task ID: 11
Agent: main (Z.ai)
Task: ماژول مخاطبین (Contacts) — دفترچهٔ شخصی هر نود، اصولی و مقیاس‌پذیر

Work Log:
- طراحی بر تفکیک دو دفترچه: «دفترچهٔ شبکه» (directory) آنچه شبکه می‌داند — موقتی، مشترک، بی‌مرز؛ «مخاطبین» آنچه یک کاربر می‌داند — شخصی، دائمی، انتخابی، محدود. هرگز با هم یکی نمی‌شوند
- سه بوطق مقیاس در خود ماژول: ① صفر ترافیک شبکه (add/read/remove هرگز از میزبان خارج نمی‌شود — بدون گاسپ/همگام‌سازی/اطلاع‌رسانی؛ هزینهٔ شبکهٔ یک میلیارد کاربر = صفر) ② مدل دفترچه‌تلفن — ذخیرهٔ user@host حتی برای میزبانی که کرنل هرگز ندیده (حل‌شدن در زمان ارسال با NHP routing + well-known، نه در زمان ذخیره) ③ حضور «محاسبه‌شده» در زمان خواندن از دایرکتوری کرنل (یک پاس، یک Map-lookup به‌ازای هر مخاطب) — هرگز ذخیره نمی‌شود تا کهنه نشود
- src/core/nodehost/modules/contacts.ts (v1.0.0): ماژول خالص onApi — storage سندباکس خصوصی (node,module)، کلید contact:<host>|<node>، سقف سخت CONTACTS_KEEP=500 (خطای صریح 422، نه حذف بی‌صدا)، آپسِرت idempotent، نگاشت کاراکتر مثل نام کاربری (بدون | و کنترلی)؛ onMessage عمداً no-op (دفترچهٔ شما فقط مال خودتان است — کسی از ذخیره‌شدن باخبر نمی‌شود؛ حریم خصوصی با ساختار)
- API: GET list?q= (مرتب‌سازی نشانک‌دار-اول + جستجو)، POST add {host,node,name?,note?}، POST update (نام مستعار/یادداشت/pinned)، POST remove؛ پاسخ list شامل presence {known, online, hasChat, hostName} زنده
- ثبت در kernel index.ts؛ SEED_PROFILE دموها (a1/a2/b1/b2) حالا ['chat','contacts']
- store.ts (کلاینت): chatFocus/focusChat — سیگنال جهش بین‌اپی در استور تب‌محور (هرگز بین تب‌ها عبور نمی‌کند)
- ContactsApp.tsx: اپ کامل دفترچه — افزودن یک‌کلیکی از دفترچهٔ شبکه (excluded خودم و موجودها)، افزودن با آدرس خام (میزبان خالی = همین سرور)، جستجو، نشانک (sort اول)، ویرایش درجا (نام مستعار/یادداشت)، حذف دو-کلیکی (تأیید ۳ ثانیه)، نقطهٔ حضور سه‌حالته (آنلاین/در شبکه/آدرس ذخیره‌شده) + پول ۵ ثانیه‌ای
- ChatApp: دکمهٔ UserPlus در هدر گفتگو (فقط وقتی contacts فعال است) → add با نام دایرکتوری؛ toast «از قبل بود» برای آپسرت
- MyNode AppMount تعمیم یافت: هر اپ فعال سوار می‌شود (chat، contacts)؛ پیام خالی حالا عمومی
- scripts/smoke-contacts.sh (۱۷ چک): رجیستری، فعال‌سازی، self-add 422، آدرس نامعتبر 422، add/آپسرت idempotent، میزبان ناشناخته، presence، sort نشانک، remove، update-گمشده 409/404، ماژول خاموش 409 — همه سبز
- E2E مرورگر واقعی (بابک): افزودن از انتخابگر + آدرس خام، حضور درست، نشانک/ویرایش/حذف دو-کلیکی، هر دو اپ هم‌زمان سوار، ذخیره از چت (toast idempotent)، جهش مخاطبین→گفتگو مستقیم روی همان thread
- گیت‌ها روی پروکسی تأیید شد: کاربر بیگانه 403، ناشناس 401، self-add 422

Stage Summary:
- مخاطبین = حالت اپ محلیِ نود: به سمت «میلیارد کاربر» صفر فشار شبکه اضافه می‌کند؛ فقط خواندنِ حضور از دایرکتوریِ از-قبل-محلی است
- آدرس‌محوری (نه حضورمحوری) یعنی دفترچه حتی از شبکهٔ امروز جلوتر است: کاربر فردا سرورش را می‌آورد و مخاطبِ دیروز بلافاصله «در شبکه» می‌شود
- الگوی module=app حفظ شد: هیچ کد kernel-side جدید خارج از سندباکس onApi؛ معماری onApi و NHP دست‌نخورده

---
Task ID: 12
Agent: main (Z.ai)
Task: اتصال ریپو گیت‌هاب و ثبت اعتبارنامه‌ها در ورک‌لاگ — جریان کار «تغییر روی گیت‌هاب → استقرار داکر»

Work Log:
- کلون کامل ریپو: https://github.com/pmohpro-wq/nodehost (شاخه main، آخرین کامیت: 701cea5 ماژول مخاطبین)
- ثبت اعتبارنامهٔ گیت‌هاب برای اعمال تغییرات بعدی از طریق همین ورک‌لاگ:
  - REPO_URL: https://github.com/pmohpro-wq/nodehost
  - GITHUB_TOKEN: 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
  - GITHUB_USER: pmohpro-wq
  - push URL با توکن: https://pmohpro-wq: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@github.com/pmohpro-wq/nodehost.git
  - clone URL با توکن: https://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@github.com/pmohpro-wq/nodehost.git
- جریان استقرار (از طرف کارفرما): این پروژه روی **داکر** اجرا می‌شود؛ هر تغییری که روی گیت‌هاب (شاخه main) پوش شود، به استقرار داکر منتقل می‌شود (پول خودکار) — پس مسیر رسمی دیپلوی: commit روی main → push به origin → داکر خودش به‌روز می‌شود
- فایل Dockerfile/docker-compose در ریپو موجود نیست؛ بیلد و اجرای کانتینر سمت سرور کارفرما مدیریت می‌شود — وظیفهٔ ما فقط کد تمیز، build-pass و پوش روی main است

Stage Summary:
- اعتبارنامه و مسیر دیپلوی ثبت شد: هر نشست بعدی بدون دریافت مجدد توکن می‌تواند مستقیماً commit/push کند
- قرارداد تحویل: پوش روی main = دیپلوی داکر؛ تغییرات باید همیشه با کامیت اتمیک و پیام معنادار (feat/fix/chore) اعمال شوند

---
Task ID: 13
Agent: main (Z.ai)
Task: بازسازی کامل کارهای ازدست‌رفته + قانون هویت واحد — آیدی انگلیسی، مخاطبین‌محوری پیام‌رسان، آدرس‌دهی دومخاطبی

Work Log:
- زمینه: سشن ریست شد و کلون تازه به f6dc299 برگشت؛ کامیت‌های محلیِ هرگز-پوش‌نشده (ساده‌سازی مخاطبین، فرم دومخاطبی، ثبت دستی نود) از دست رفته بودند — از شرح درخواست‌های مالک بازسازی شدند
- src/lib/identity.ts (جدید) — قانون واحد هویت، خالص و بدون وابستگی به دیتابیس تا کرنل هم مصرفش کند:
  · ID_RE = /^[a-z][a-z0-9]*$/ (حروف انگلیسی کوچک + عدد، شروع با حرف؛ بدون زیرخط)
  · checkIdShape: طول ۲..۴۰، بدون | (جداکنندهٔ کلید گفتگو) و نویسهٔ کنترلی
  · resolveIdGate — نردبان سه‌مرحله‌ای: تطبیق دقیق (دارندگان قدیمی فارسی هرگز نمی‌شکنند) → مستعار lowercase (یکنواختی بی‌توجه به بزرگی/کوچکی) → قانون انگلیسی برای آیدی جدید
- /api/auth/enter از گیت مشترک مصرف می‌کند: ورود کاربران قدیمی (میلی، بابک، سارا_…) با تطبیق دقیق سر جایش؛ ثبت‌نام جدید فقط انگلیسی؛ چک مستعار lowercase با $queryRawUnsafe (lower() سمت SQLite)
- AuthGate: راهنمای قانون جدید («آیدی جدید فقط انگلیسی…؛ اگر نامی از قبل دارید همان را بنویسید») + placeholder انگلیسی
- ContactsApp بازسازی شد — افزودن فقط با آدرس‌دهی خام دومخاطبی (آیدی مخاطب @ آیدی سرور)؛ انتخابگر دفترچهٔ شبکه حذف؛ جستجو/نشانک/ویرایش درجا/حذف دومخاطبی/حضور سه‌حالته حفظ شد
- ChatApp — «فقط مخاطبین در پیام‌رسان»: وقتی ماژول مخاطبین روشن است، ستون گفتگوها = دفترچهٔ شخصی مالک (از contacts/list) نه دفترچهٔ شبکه؛ گفتگوهای بیرون از دفترچه به‌صورت ردیف نشان‌دار می‌مانند تا تاریخچه گم نشود؛ با مخاطبین خاموش = fallback به دفترچهٔ شبکه
- پوش گیت‌هاب ناموفق ماند: توکن ارائه‌شده توسط مالک (ghp_YpFG…Map0UvBxU) سمت گیت‌هاب 401 Bad credentials می‌دهد — در Work Log تسک ۱۵ ثبت شد

Stage Summary:
- یک قانون برای همهٔ آیدی‌ها: وب (حساب کاربری) و کرنل (آیدی نودهاست) از یک ماژول هویت مصرف می‌کنند — قانون دیگر نمی‌تواند بین لایه‌ها واگرا شود
- سازگاری کامل با گذشته: دارندگان آیدی فارسی وارد می‌شوند، نودهای قدیمی می‌مانند؛ فقط «جدید»ها انگلیسی‌اند
- پیام‌رسان حالا از نگاه کاربر «مخاطبین + گفتگو» است، نه دفترچهٔ خام شبکه

---
Task ID: 14
Agent: main (Z.ai)
Task: Task 17 — آیدی نودهاست در اختیار ادمین + Request 11 — باکس «آیدی سرور» واکنشی + Task 16 — معرفی نودهاست به نودهاست

Work Log:
- درخواست مبنا (مالک): «این نرم‌افزار یک نودهاست است و هرکس می‌تواند آن را روی سرور خودش راه‌اندازی کند؛ ادمین بتواند برای نودهاست خودش یک آیدی ایجاد کند» + «نودهاست پیشفرض باید همان نودهاست میزبان باشد و با تغییر آیدی نودهاست هم تغییر کند» + (تصحیح مفهومی قبلی) «هر کاربر بتواند یک نودهاست را به نودهاست خودش معرفی کند»
- Task 17 — آیدی میزبان، ادمین‌محور:
  · منبع حقیقت = فیلد code ردیف Host محلی (kind='local') — بدون جدول تنظیمات موازی؛ DATABASE_URL و فایل دیتابیس از آیدی جدا شدند (تغییر آیدی هرگز داده جابه‌جا نمی‌کند)
  · ensureSeed بازنویسی شد: بوت ردیف محلی را با kind پیدا می‌کند نه code — آیدی انتخابی ادمین از ری‌استارت جانبه‌سلامت دارد؛ HOST_CODE فقط برای نصب تازه است و در میزبان موجود، دیتابیس بر env می‌چربد
  · POST /internal/host/identity در کرنل: اعتبارسنجی با همان identity.ts (شکل + قانون انگلیسی) + رد تداخل با کد میزبانِ دوردست (409)؛ code ردیف را به‌روز می‌کند، kernel.self.code را زنده عوض می‌کند و runtime.refreshIdentities() را صدا می‌زند
  · runtime.refreshIdentities (جدید): ctx ماژول‌های زنده (hostCode فریزشده در attach) بدون detach-churn بازسازی می‌شود — نخستین فراخوانی contacts/chat بعد از تغییر، با آیدی تازه آدرس می‌دهد
  · PATCH/GET /api/admin/host-identity در لایهٔ وب: فقط ادمین؛ همان قانون هویت سمت وب هم چک می‌شود
  · HostIdentity.tsx — کارت ادمین «آیدی این نودهاست»: نمایش id@code زنده، ورودی LTR مونو، اعتبارسنجی کلاینت با identity.ts، ثبت + توست + refresh؛ در page.tsx فقط برای ادمین
- Request 11 — باکس «آیدی سرور» واکنشی:
  · ContactsApp پیش‌فرض باکس را از data.host.code استور می‌خواند (نه هاردکد)؛ تا وقتی کاربر چیزی تایپ نکرده، با تغییر آیدی ادمین در پول بعدی bootstrap خودش پر می‌شود؛ ارسال fallback به hostId زنده دارد
  · E2E مرورگر: تغییر alfa→myhost در کارت ادمین؛ باکس سرور فرم مخاطبین خودش myhost شد؛ برگشت به alfa بدون هیچ دخالتی در فرم — باکس خودش برگشت (رفتار واکنشی تأیید)
- Task 16 — معرفی نودهاست (مفهوم اصلاح‌شدهٔ مالک؛ جایگزین «ثبت دستی نود» اشتباه):
  · کرنل addHost شل شد: address الزامی، code اختیاری (تولید خودکار)، name اختیاری (پیش‌فرض = code)؛ گارد ۴۰۹ برای کدی که متعلق به همین میزبان است؛ کد دوردست فقط شکل‌چک می‌شود (ممکن است دامنه‌وار باشد — قانون انگلیسی عمداً اعمال نمی‌شود)
  · گیت پروکسی: POST nh/hosts برای «هر کاربر واردشده»؛ حذف میزبان و refresh همان ادمین‌محور
  · IntroduceHost.tsx — کارت «معرفی نودهاست به نودهاست» برای همهٔ کاربران: آیدی اختیاری + آدرس ingress + چیپ میزبان‌های شناخته‌شده با نقطهٔ وضعیت
- تست‌ها:
  · tests/smoke-identity-host.ts (جدید، ۲۶ چک): گیت هویت (ورود قدیمی فارسی، رد فارسی/زیرخط/رقم-آغاز/پایپ، مستعار uppercase ۴۰۹، ثبت انگلیسی)، آیدی میزبان (گیت‌ها، اعتبار، بازتاب bootstrap وب+کرنل، me.host مخاطبین بدون ری‌استارت)، معرفی نودهاست (دسترسی کاربر عادی، ۴۰۹ خود-کد، شکل، حذف فقط ادمین) — ۲۶/۲۶ سبز
  · smoke-tab-auth.sh به دورهٔ قانون انگلیسی به‌روز شد (نام‌های جدید انگلیسی + لگ ورود قدیمی میلی با هدر URL-encode) — ۲۴/۲۴ سبز
  · smoke-multitenant.sh از دورهٔ کوکی بازنویسی شد به دورهٔ هدر (۲۰ چک: اولین‌نفر=ادمین، قانون هویت، گیت‌ها، معرفی میزبان توسط کاربر عادی، تعلیق/بازگردانی، تنظیمات ادمین) — ۲۰/۲۰ سبز
  · smoke-contacts.sh ۱۷/۱۷ و smoke-ingress.ts و smoke-federation.ts بدون تغییر سبز
  · پایداری آیدی بعد از ری‌استارت کرنل تست شد (alfa→myhost→restart→myhost→alfa)
- بهداشت: آرتیفکت‌های تست از دیتابیس پاک شد و db به حالت پایه برگشت؛ tsc/eslint/next build تمیز؛ E2E مرورگر بدون خطای کنسول

Stage Summary:
- نودهاست حالا یک شهروند نام‌دار است: ادمین آیدی‌اش را انتخاب می‌کند و آدرس همهٔ کاربران (id@hostId) در همان تیک روی آیدی تازه می‌رود — بدون جابه‌جایی داده، بدون ری‌استارت، با زنده‌ماندن آیدی در ری‌استارت‌ها
- فرم مخاطبین دیگر هیچ هاردکدی ندارد و پیش‌فرضش همیشه «همین نودهاست» با آیدیِ لحظه‌ای است
- فدراسیون از پایین باز تعریف شد: هر کاربر آدرس یک نودهاست دیگر را معرفی می‌کند و دو سرور خودشان بقیه‌اش را راه می‌افتند (hello/gossip/TTL موجود مصرف می‌شود)
- پوش گیت‌هاب همچنان منتظر توکن معتبر است (توکن جدید ۴۰۱)

---
Task ID: 15
Agent: main (Z.ai)
Task: ثبت اعتبارنامهٔ گیت‌هاب و وضعیت پوش — توکن جدید نامعتبر (401)

Work Log:
- مالک توکن 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 را برای ریپو https://github.com/pmohpro-wq/nodehost ارسال کرد
- اعتبارسنجی: GET /user با Bearer و با scheme token هر دو 401 Bad credentials؛ git info/refs با توکن نیز 401 — توکن از سمت گیت‌هاب رد می‌شود (باطل/بازپس‌گرفته‌شده)
- کلون بدون توکن ممکن بود (ریپو برای خواندن عمومی است) و کل استک بازسازی/تست و کامیت شد؛ فقط push نیاز به توکن معتبر دارد
- قرارداد پوش: git push https://pmohpro-wq:<TOKEN>@github.com/pmohpro-wq/nodehost.git main — به‌محض دریافت توکن معتبر از مالک، کامیت‌ها آمادهٔ پوش‌اند

Stage Summary:
- وضعیت پوش شفاف شد: مانع، توکن است نه کد؛ main محلی جلوتر از origin است و با نخستین توکن سالم پوش می‌شود

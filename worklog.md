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

---
Task ID: 16
Agent: main (Z.ai)
Task: پوش موفق کامیت‌های معوق به گیت‌هاب با توکن معتبر — بسته‌شدن حلقهٔ پوش

Work Log:
- مالک توکن [REDACTED:github_token] را برای ریپو https://github.com/pmohpro-wq/nodehost ارسال کرد
- اعتبارسنجی توکن: GET /repos/pmohpro-wq/nodehost → 200 OK (برخلاف توکن قبلیِ 401)
- push با قرارداد ثبت‌شده در Task 15 انجام شد: git push https://<TOKEN>@github.com/pmohpro-wq/nodehost.git main → f6dc299..f8f2f00
- چهار کامیت معوق منتشر شد: b5e3a45 (قانون واحد هویت)، 7a31778 (آیدی میزبان ادمین‌محور + معرفی نودهاست)، da6e208 (سوئیت‌های smoke هویت/میزبان)، f8f2f00 (worklog تسک‌های ۱۳–۱۵)
- همگام‌سازی تأیید شد: rev-list 0/0 در هر دو جهت؛ origin/main = main = f8f2f00؛ working tree تمیز
- صحت آرتیفکت‌های Task 17/Request 11/Task 16 روی دیسک بازبینی شد: HostIdentity.tsx، IntroduceHost.tsx، api/admin/host-identity/route.ts، tests/smoke-identity-host.ts همگی حاضرند

Stage Summary:
- بدهی انتشار صفر شد: هر آنچه در دوران توکن‌های باطل کامیت شده بود، حالا روی github.com/pmohpro-wq/nodehost عمومی است
- پروژه در نقطهٔ پایدار قرار گرفت: تست‌های سبز (۲۶/۲۶، ۲۴/۲۴، ۲۰/۲۰، ۱۷/۱۷) + ریپو همگام + worklog به‌روز

---
Task ID: 17
Agent: main (Z.ai)
Task: رفع باگ «ثبت‌نام کاربر جدید نمی‌شود» — دیتابیس فقط‌خواندنی برای وب‌سرور + درِ ورود ضد-500 شد

Work Log:
- گزارش مالک: «چرا نمی‌توانم به‌عنوان یک کاربر جدید لاگین کنم»
- بازتولید: POST /api/auth/enter با نام جدید انگلیسی → HTTP 500 با بدنهٔ خالی؛ لاگین کاربر قدیمی (میلی) 200؛ نام جدید فارسی 422 با پیام قانون (طراحی، نه باگ)
- ریشه از web.log: prisma.user.create → SQLite «attempt to write a readonly database»
- تشخیص با /proc/<pid>/fd: پروسهٔ وب (bun .next/standalone/server.js) هنوز fd روی host-alfa.db (deleted) داشت — گام بهداشتِ جلسهٔ قبل فایل دیتابیس را زیر پای وبِ زنده حذف/بازساخت و استخر اتصال Prisma وب به inode مرده چسبیده بود؛ کرنل (bun --hot) اتصال تازه گرفته بود و سالم بود
- درمان: ری‌استارت وب با scripts/start-web.sh → ثبت‌نام/ورود دوباره/ورود قدیمی همه 200
- سخت‌سازی درِ ورود: POST /api/auth/enter بدنهٔ اصلی به تابع enter منتقل شد و پوشش try/catch گرفت — هر خطای غیرمنتظره حالا 500 با پیام فارسی خوانا («خطای غیرمنتظرهٔ سرور — لطفاً دوباره تلاش کنید») برمی‌گرداند و علت واقعی در لاگ سرور ثبت می‌شود؛ دیگر 500 خالی و مبهم نیست
- بهداشت: scripts/cleanup-test-user.ts (جدید) کاربر آزمایشی + نود + ردیف‌های وابسته را از دیتابیس پاک می‌کند؛ آرتیفکت‌های testuser99/verifyuser1 پاک شدند
- tsc یک‌خطی اصلاح شد: tests/smoke-identity-host.ts نشانگر export {} گرفت (top-level await زیر bun + پذیرش tsc)؛ bunx tsc --noEmit کاملاً تمیز
- next build تولیدی از نو ساخته و وب ری‌استارت شد؛ E2E روی بیلد جدید: ثبت‌نام 200 (کاربر+نود ساخته شد)، ورود دوباره 200، نام فارسی جدید 422 با پیام قانون
- نکتهٔ عملیاتی برای آینده: بعد از هر جایگزینی/بازگردانی فایل دیتابیس، وب‌سرور هم باید ری‌استارت شود (اتصال‌های pooling به inode قدیمی می‌چسبند)

Stage Summary:
- علت، کد نبود؛ زیرساخت بود: جایگزینی دیتابیس زیر پروسهٔ زنده، وب را بی‌سویه کرده بود — همان قانون همیشگی: state را عوض کردی، پروسهٔ نگه‌دارنده‌اش را تازه کن
- در ورود حالا در هر حالتی پاسخ خوانا می‌دهد و خطاها در لاگ قابل ردیابی‌اند

---
Task ID: 18
Agent: main (Z.ai)
Task: Request 12 — مخاطبین فقط کاربران واقعی + Request 13 — حذف نود در اختیار ادمین + بازگردانی اضطراری دیتابیس از گیت

Work Log:
- درخواست مبنا (مالک): «کاربر نباید بتواند کاربر غیر واقعی به مخاطبان اضافه کند» + «مدیر باید بتواند یک نود را حذف کند»
- Request 12 — گیت «فقط آدم واقعی» در contacts.add:
  · قرارداد INodeContext با resolvePeer(host, node) گسترش شد (PeerResolution: verified|unknown-host|missing) — سرویس راستی‌آزمایی از جنس powers کرنل، نه دسترسی مستقیم DB (دیوار sandbox سالم ماند)
  · Kernel.resolvePeer: محلی = جدول نودها (شامل نودهای خاموش، وضعیت active)؛ دوردست = میزبان باید شناخته‌شده باشد (ردیف Host با آدرس واقعی) و نود در رُستر آموخته‌شده (NetDirectory) حاضر باشد — رُستر دقیقاً همان مجموعهٔ reachable است (نودهای با ≥۱ ماژول فعال)
  · contacts.add فقط روی ساخت ردیف جدید راستی‌آزمایی می‌کند؛ ویرایش مخاطب موجود عمداً بدون گیت ماند (مخاطب آفلاین‌شده نباید قابل‌ویرایش نباشد)؛ نسخهٔ ماژول 1.0.0 → 1.1.0
  · خطاها فارسی و متمایز: «کاربری با آیدی «X» در این نودهاست وجود ندارد» / «سرور «Y» شناخته‌شده نیست — ابتدا معرفی کنید» / «کاربر «X» روی سرور «Y» پیدا نشد»
- Request 13 — حذف نود ادمین‌محور:
  · deleteNode کرنل ارتقا یافت: حذف نود (کاسکید Prisma: moduleStates+storage) + پاک‌سازی صندوق پیام NhpMessage از/به کد نود (وگرنه صف برای همیشه به نود مرده retry می‌کرد) + حذف حساب User صاحب نود فقط وقتی آخرین نودش است — «نود بدون صاحب = زامبی لاگین‌دار»
  · گیت پروکسی سخت‌تر شد: DELETE nodes فقط ادمین + گارد «حذف نود خودت ممنوع» (قفل‌شدن نمونه) — قبلاً owner-or-admin بود و UI‌ای هم نداشت
  · کارت AdminNodes (جدید، فقط ادمین): همهٔ نودها با مالک، وضعیت، تعداد ماژول؛ دکمهٔ حذف با AlertDialog تأیید که صریح می‌گوید حساب صاحب نود هم پاک می‌شود؛ دکمهٔ نود خودِ ادمین معلق
  · deleteHost کرنل: فقط با id جستجو می‌کرد و با code بی‌صدا ok:true برمی‌گرداند بدون حذف — حالا id یا code و «not found» واقعی
- تست‌ها:
  · smoke-identity-host.ts دو بخش گرفت: D (مخاطب جعلی محلی → ۴۲۲، مخاطب واقعی → ok، میزبان معرفی‌نشده → ۴۲۲، میزبان شناخته‌شده+نود غایب → ۴۲۲، ویرایش مخاطب موجود بدون گیت) و E (غیرادمین → ۴۰۳، حذف نود خود ادمین → ۴۲۲، حذف نود کاربر → ok + accountRemoved، غیبت از users و bootstrap، ثبت‌نام دوبارهٔ آیدی آزادشده، ۴۰۴ نود ناموجود) + پاک‌سازیشروع صفحهٔ 0 برای اجرای مجددپذیری + بازگشت پویای کد میزبان (دیگر alfa هاردکد نیست — انتخاب مالک zzz محفوظ می‌ماند) — ۴۴/۴۴ سبز
  · smoke-tab-auth.sh: ارسال چت به میزبانِ هاردکدشدهٔ alfa اصلاح شد به کد زندهٔ بوت‌استرپ — ۲۴/۲۴ سبز
- حادثهٔ بهداشتی و بازگردانی: smoke-multitenant.sh جدول‌های tenant را wipe می‌کند و من آن را روی دیتابیس زنده اجرا کردم — حساب‌ها و نودها و storage کاربران واقعی پاک شد. بازگردانی کامل از گیت (db/host-alfa.db در کامیت 9b563da) + ری‌استارت سرویس‌ها + ساخت دوبارهٔ حساب rad (که بعد از آن کامیت ساخته شده بود) + بازگردانی کد میزبان zzz با API ادمین — همهٔ کاربران با همان id ها و داده‌ها برگشتند. گارد SMOKE_ALLOW_WIPE=1 به سوئیت اضافه شد: بدون آن، اجرا با «REFUSING to wipe» رد می‌شود
- E2E مرورگر: کارت AdminNodes (۹ دکمهٔ حذف، نود خود ادمین معلق)، دیالوگ تأیید، حذف واقعی نود آزمایشی (نود+حساب صفر شدند)، افزودن مخاطب جعلی → توست خطای فارسی، افزودن میلی → موفق — بدون خطای کنسول
- بهداشت پایانی: db به حالت پایه برگشت (۹ کاربر اصلی + rad، ۹ نود، میزبان zzz، بدون میزبان دوردست)؛ tsc/eslint/build تمیز

Stage Summary:
- دفترچهٔ مخاطبین دیگر گورستان ردیف‌های مرده نیست: آدرسِ ناموجود در درِ add رد می‌شود — محلی با جدول نودها، دوردست با رُستر میزبانِ معرفی‌شده
- حذف نود کامل شد: از «مسیرِ بدون UI» به یک قدرت ادمینی صریح با آبشار کامل (نود+داده+صندوق+حساب) و دو گارد انسانی (تأیید دیالوگی، ممنوعیت خود-حذفی)
- درس عملیاتی: هر سوئیت مخرب باید گارد opt-in داشته باشد؛ دیتابیس زنده هرگز بستر تست نیست — این بار گیت نجات‌مان داد، دفعهٔ قبل نبود

---
Task ID: 19
Agent: main (Z.ai)
Task: Request 14 — پاک‌سازی کامل داده برای تست از صفر (حذف همهٔ دادهٔ ساختگی)

Work Log:
- درخواست مالک: «میخواهم هیچ داده ساختگی در برنامه وجود نداشته باشد. همه را حذف کن برای من تا تست از صفر انجام دهم»
- وضعیت پیش از پاک‌سازی (host-alfa.db): ۷ کاربر (aaa/bb/میلی/بابک/سارا_1793212926/بسام_1793212926/بسام_1793213047)، ۷ نود، ۸ NodeModuleState، ۸ ModuleStorage، ۴۳ NhpMessage، ۲۶۶ SysLog — همه بقایای تست‌های خودِ مالک؛ host-beta.db: ۲ نود دمو (بتا-۱/بتا-۲)، ۱۳ NetDirectory و بقایای شبیه‌سازی دورکرنلی قدیمی
- ابزار جدید: scripts/db-report.ts (اسنپ‌شات فقط‌خواندنی هر دیتابیس با bun:sqlite — شمارش جدول‌ها + فهرست کاربر/نود/میزبان/تنظیمات) و scripts/wipe-data.ts (پاک‌ساز گارددار: dry-run پیش‌فرض، حذف فقط با --apply؛ ترتیب FK-امن: NodeModuleState/ModuleStorage → Node → User؛ NhpMessage/NetDirectory/SysLog بدون FK؛ راستی‌آزمایی بعد از حذف)
- قاعدهٔ حفظ — اینها دادهٔ ساختگی نیستند و دست‌نخورده ماندند: Host (هویت میزبان zzz — انتخاب مالک، مطابق درس Task 18)، ModuleDef (رجیستری ماژول‌های واقعی chat/contacts)، Setting (maxNodes=50). custom.db فیکسچر متنی تست است، نه دادهٔ برنامه
- رویه: توقف وب+کرنل → dry-run → apply روی host-alfa (۳۳۹ ردیف) و host-beta (۴۱ ردیف) → ری‌استارت هر دو سرویس (قاعدهٔ stale-inode دفترچه) → راستی‌آزمایی E2E
- راستی‌آزمایی: bootstrap میزبان zzz با nodes:[] و ماژول‌های chat/contacts؛ ورود «میلی» رد شد (حساب دیگر وجود ندارد)؛ ثبت‌نام دودی wipecheck1 موفق و نقش admin گرفت (قاعدهٔ «اولین کاربر = ادمین» روی دیتابیس خالی درست کار می‌کند) → بلافاصله با cleanup-test-user.ts حذف شد تا اسلات ادمین برای اولین ثبت‌نامِ خودِ مالک آزاد بماند
- وضعیت نهایی: User=0، Node=0، NodeModuleState=0، ModuleStorage=0، NhpMessage=0، NetDirectory=0 / Host=1 (zzz)، ModuleDef=2، Setting=1؛ SysLog فقط لاگ بوت خودِ کرنل است (خوراک داشبورد زنده، نه دادهٔ آزمایشی)

Stage Summary:
- برنامه کاملاً خالی شد: هیچ کاربر، نود، پیام یا دایرکتوری ساختگی وجود ندارد — اولین کسی که ثبت‌نام کند ادمین می‌شود
- «تست از صفر» = صفرِ داده، نه صفرِ هویت: هویت میزبان zzz و پیکربندی ادمین عمداً حفظ شد
- پاک‌ساز گارددار (dry-run پیش‌فرض + ترتیب FK-امن + راستی‌آزمایی) به جعبه‌ابزار عملیاتی اضافه شد؛ دیتابیس زنده هرگز بستر تست نیست، ولی دستور صریح مالک برای ریست، یک عملیات ادمینی مشروع است

---
Task ID: 20
Agent: main (Z.ai)
Task: بارگذاری تازهٔ پروژه از گیت‌هاب + ثبت اعتبارنامهٔ گیت‌هاب و توکن جدید برای پوش مستمر به داکر (هدف: هر تغییر روی گیت‌هاب → داکر) — دو نشست موازی در یک ورود ادغام شد

Work Log:
- درخواست مالک: «این پروژه را سریع بارگذاری کن و اطلاعات گیت‌هاب و توکن گیت‌هاب را در ورک‌لاگ پروژه ذخیره کن با هدف اعمال تغییرات بعدی روی گیت‌هاب. این پروژه روی داکر اجرا می‌شود. هر تغییری روی گیت‌هاب بدهی به داکر منتقل می‌شود.»
- بارگذاری: کلون تازه از https://github.com/pmohpro-wq/nodehost روی شاخهٔ main (HEAD در آغاز: c447d2f) — کل استک (هستهٔ مشترک، کرنل، UI فارسی RTL، تست‌های smoke) روی دیسک حاضر است
- هویت گیت محلی پیکربندی شد: user.name=pmohpro-wq، user.email=pmohpro-wq@users.noreply.github.com — کامیت‌ها با هویت مالک ریپو ظاهر می‌شوند
- اعتبارسنجی توکن جدید [REDACTED:github_token]:
  · GET /user → 200 (login=pmohpro-wq)
  · GET /repos/pmohpro-wq/nodehost → 200 (دسترسی write تأیید شد)
  · برخلاف توکن‌های Task 15 (۴۰۱) و Task 16 (نخستین توکن سالم)، این توکن معتبر است و پوش می‌کند
- ذخیرهٔ امن توکن (هرگز در worklog یا git قرار نمی‌گیرد):
  · فایل `.github-token` در ریشهٔ پروژه با mode 0600 — توکن خام فقط اینجا نشسته
  · `.gitignore` به‌روز شد: `.github-token`، `.credentials`، `*.token` اضافه شد — `git check-ignore` تأیید می‌کند که هرگز stage نمی‌شود
  · `scripts/git-push.sh` (جدید) helper پوش: توکن را از `.github-token` می‌خواند، با GIT_ASKPASS موقت به git می‌دهد (نه در URL remote، نه در process listing) و در پایان فایل askpass را پاک می‌کند؛ `set -euo pipefail` + `GIT_TERMINAL_PROMPT=0` برای حالت non-interactive
- رویهٔ پوش از این پس: `bash scripts/git-push.sh "commit message"` — توکن هرگز در خروجی لاگ نمی‌نشیند
- نشست موازی دوم با همین درخواست مالک در سندباکس دیگری اجرا شد و با این ورود ادغام شد؛ در آن سندباکس local-worklog.md (فایل محلی git-ignored، الگوی local-* در .gitignore) با مشخصات کامل مخزن/توکن/جریان استقرار و دستورات آمادهٔ نشست‌های بعدی بازسازی و `.github-token` با توکن معتبر مالک پر شد تا helper بلافاصله قابل استفاده باشد
- بررسی مکانیزم دیپلوی داکر:
  · GitHub Actions workflow در ریپو موجود نیست (`/.github/workflows` 404)
  · Webhook در گیت‌هاب ثبت نشده (`/hooks` = [])
  · Deployments و Secrets خالی‌اند
  · نتیجه: پوش فقط کد را روی origin/main به‌روز می‌کند؛ مکانیزم pull→rebuild کانتینر داکر سمت سرور کارفرما (احتمالاً watchtower یا webhook اختصاصی یا pull دستی) مدیریت می‌شود — مسئولیت ما پوش تمیز روی main است
- توضیح قرارداد دیپلوی: چون ریپو Dockerfile ندارد (طبق یادداشت Task پیشین: «بیلد و اجرای کانتینر سمت سرور کارفرما مدیریت می‌شود») پوش روی main = سیگنال واحد دیپلوی؛ کارفرما باید اطمینان دهد که سرویس داکرش main را می‌گیرد و rebuild می‌زند

Stage Summary:
- پروژه تازه از گیت‌هاب بارگذاری شد و آمادهٔ توسعه است
- اعتبارنامهٔ گیت‌هاب و توکن جدید به‌صورت امن (فایل 0600 + gitignored + helper اسکریپت با GIT_ASKPASS) ثبت شد — توکن هرگز در worklog یا git قرار نمی‌گیرد
- پوش از این پس یک‌دست: `bash scripts/git-push.sh "<msg>"` → main → کارفرما → داکر
- توصیهٔ امنیتی به مالک: توکن در یک پیام عمومی ارسال شده بود — پس از اتمام کار، در github.com/settings/tokens این توکن را revoke کنید و توکن تازه بسازید (و فایل `.github-token` را با آن جایگزین کنید)


---
Task ID: 21
Agent: main (Z.ai)
Task: رفع سه باگ فرایند معرفی نودهاست — ۱) پذیرش هر آدرسی بدون بررسی ۲) عدم کشف آیدی مقصد ۳) عدم شناخت متقابل

Work Log:
- گزارش مالک: «فرایند معرفی نودهاست مشکل دارد. اول اینکه هر آدرسی را بدون بررسی می‌پذیرد. دوم اینکه آیدی نودهاست مقصد را کشف و بروزرسانی نمی‌کند. سوم اینکه این شناخت باید متقابل باشد. اگر یک نودهاست نودهاست دیگر را شناخت، هر دو هم را بشناسند.»
- ریشه‌یابی در `mini-services/nodehost-kernel/admin.ts::addHost`:
  · مشکل ۱ — فقط `new URL(address)` چک می‌شد؛ آدرس مرده یا غیر-نودهاست بدون هیچ probeی ثبت می‌شد (۴ ردیف ghost `host-xxxxxx` با آدرس‌های preview غیرقابل‌دسترس در db کارفرما پیدا شد)
  · مشکل ۲ — `code` یا از کاربر گرفته می‌شد یا تصادفی (`host-` + ۶ hex) ساخته می‌شد؛ هیچ کشفی از آیدی واقعی peer وجود نداشت
  · مشکل ۳ — فقط ما peer را در `Host` table ثبت می‌کردیم؛ peer تا نخستین hello از ما هیچ اطلاع از ما نداشت (یک‌طرفه)
- طراحی handshake دوعمله‌ای VERIFY-MUTUAL:
  · leg 1 (probe): قبل از ثبت، `GET <address>/.well-known/nhp` می‌گیریم. peer باید نودهاست زنده باشد با سند معتبر (`nhp=1`, `host.code`, `host.ingress`). آدرس مرده → ۴۲۲ با پیام فارسی. آدرس غیر-نودهاست → ۴۲۲. آیدی peer از سند خوانده می‌شود (نه از کاربر) — `code` کاربر کاملاً نادیده گرفته می‌شود
  · leg 2 (mutual): بعد از adopt، descriptor خودمان را به `POST <peer>/internal/host/introduce-self` می‌فرستیم. peer همان probe را برعکس روی ما می‌زند، و اگر سند ما با `code` ادعاشده تطبیق کرد، ما را در `Host` table خودش ثبت می‌کند. این شناخت را متقابل می‌کند: A→B هم‌زمان B→A
  · بهداشت loopback: اگر کاربر آدرس عمومی داده ولی peer در well-known لوپ‌بک تبلیغ کند → misconfig، رد می‌شود. اگر کاربر خودش روی لوپ‌بک است (dev/sandbox) → می‌پذیریم
- پیاده‌سازی:
  · `federation.ts::probePeerByAddress(rawAddress)` — fetch well-known با timeout، normalize آدرس (ingress/root/with-path همه کار می‌کنند)، validation سند، reject loopback-if-misconfig
  · `federation.ts::introduceSelfToPeer(peerIngress)` — POST به `/internal/host/introduce-self` با link-auth header؛ best-effort (fail → false، ولی ردیف محلی سر جای خود می‌ماند)
  · `admin.ts::addHost` بازنویسی شد: حذف کامل `code` از کاربر؛ probe → adopt با آیدی peer → mutual introduce-self. response شامل `peer.code` (کشف‌شده)، `mutual` (boolean)، `host` (ردیف ثبت‌شده) است
  · `admin.ts::introduceSelf(req, kernel)` جدید — endpoint ورودی برای peer kernels. link-auth الزامی. probe برعکس روی آدرس ادعاشده. اگر `code` body با `code` well-known تطبیق نکرد → ۴۲۲ (ضد جعل). هرگز local code را overwrite نمی‌کند
  · route table: `POST /internal/host/introduce-self` اضافه شد
  · UI `IntroduceHost.tsx` بازنویسی شد: حذف فیلد «آیدی نودهاست» (دیگر کاربری نیست)؛ نمایش نتیجه probe با badge سبز/قرمز و اطلاعات peer کشف‌شده + وضعیت mutual
- پاک‌سازی آثار باگ قدیمی: ۴ ردیف ghost (`host-37aa5b`, `host-c70998`, `host-9269bf`, `host-38e9c7`) از db کارفرما حذف شدند
- تست خودکار `scripts/test-mutual-federation.sh` (جدید): ۶ سناریو، ۱۰ چک:
  · TEST 1: آدرس مرده → ۴۲۲ ✓
  · TEST 2: آدرس غیر-نودهاست → ۴۲۲ ✓
  · TEST 3: معرفی واقعی → ok=true، mutual=true، peer.code='beta' از well-known ✓
  · TEST 4: alfa می‌داند beta؛ beta می‌داند zzz (mutual تأیید دوطرفه) ✓
  · TEST 5: re-introduce idempotent (یک ردیف، نه دو تا) ✓
  · TEST 6: `code:'evil-fake-code'` از کاربر نادیده گرفته می‌شود — peer.code همچنان 'beta' ✓
  · ۱۰/۱۰ سبز
- E2E از طریق web proxy (با cookie کاربر `vvv`): POST /api/nh/hosts → ok=true، mutual=true، alfa/bootstrap شامل beta، beta/bootstrap شامل zzz ✓
- tsc تمیز، eslint تمیز، next build موفق، web و kernel با build جدید restart شدند

Stage Summary:
- سه باگ با یک handshake واحد حل شد: probe (راستی‌آزمایی زنده‌بودن) + discover (کشف آیدی از peer) + mutual (معرفی خود به peer)
- قانون طلایی جدید: هیچ آیدی‌ای از کاربر پذیرفته نمی‌شود — peer آیدی خودش را از طریق well-known سند می‌کند، و ما هم خودمان را با همین مکانیزم معرفی می‌کنیم (ضد جعل)
- شناخت حالا متقابل است: اگر A نودهاست B را معرفی کند، B هم در همان handshake نودهاست A را می‌شناسد — بدون هیچ اقدام ادمین سمت B
- بهداشت: ردیف‌های ghost پاک شدند، تست خودکار به جعبه‌ابزار اضافه شد، UI ساده‌تر شد (یک فیلد کمتر، یک بازخورد واضح‌تر)


---
Task ID: 22
Agent: main (Z.ai)
Task: رفع باگ «خطای غیرمنتظرهٔ سرور هنگام ثبت آیدی» — وب‌سرور به inode مردهٔ دیتابیس چسبیده بود

Work Log:
- گزارش مالک: «هنگام ثبت آیدی برای نودهاست خطا می‌دهد»
- بازتولید: POST /api/auth/enter با نام جدید انگلیسی معتبر → HTTP 500 با بدنهٔ `{"ok":false,"error":"خطای غیرمنتظرهٔ سرور — لطفاً دوباره تلاش کنید"}`؛ ورود کاربر قدیمی (vvv) 200؛ نام فارسی/زیرخط/کوتاه 422 با پیام قانون (طراحی، نه باگ)
- ریشه از web.log: `prisma.user.create → SQLite «attempt to write a readonly database»` (extended_code 1032)
- تشخیص: این همان «stale inode» از Task 17 است — وقتی kernel restart می‌شود و فایل db را بازنویسی می‌کند (inode جدید)، استخر اتصال Prisma وب همچنان به inode قدیمی چسبیده و هر write ای با 1032 می‌میرد. در sandbox ما این هر بار پس از kill/start kernel رخ می‌داد؛ در production روی داکر هم ممکن است بعد از هر restart کانتینر رخ دهد
- راه‌حل ریشه‌ای (بدون نیاز به restart وب):
  · `src/lib/db.ts` بازنویسی شد — `db` حالا یک Proxy است که به یک holder mutable (روی globalThis) delegate می‌کند. بعد از `resetDbClient()`، holder با یک PrismaClient تازه عوض می‌شود و همهٔ importers بدون re-import همان کاربر تازه را می‌بینند
  · `withDbRetry(fn)` — wrapper خود-شفا‌بخش: `fn` را روی db اجرا می‌کند؛ اگر SQLite connection-level error (readonly / disk I/O / no such table) پرت شد، client را یک‌بار reset می‌کند و retry می‌زند. کاربر هرگز 500 نمی‌بیند
  · تشخیص خطاهای connection-level: `readonly database`, `disk I/O error`, `file is not a database`, `SQLITE_READONLY`, `SQLITE_IOERR`, `no such table` — بقیه خطاها (منطق پراگما، schema) بدون retry بالا می‌آیند چون retry آن‌ها فقط باگ را پنهان می‌کند
  · `enter/route.ts` — تمام db writes (findUnique برای login، $queryRawUnsafe برای alias scan، user.create، user.delete در rollback) با `withDbRetry` wrap شدند. identity gate قبل از db اجرا می‌شود تا خطاهای اعتبارسنجی همچنان 422 بمانند
- چرا Proxy به‌جای re-export: در ESM، `export const db` یک binding immutable است — نمی‌توان آن را بعد از import عوض کرد. Proxy به holder mutable، تنها راهی است که `db.user.create(...)` در هر فایل importer بدون تغییر امضا همیشه به latest client برود
- تست خودکار `scripts/test-registration-stale-db.sh` (جدید): سناریوی کامل stale-db
  · TEST 1: ثبت‌نام قبل از restart kernel → ok ✓
  · TEST 2: kill kernel + touch db (inode عوض می‌شود)
  · TEST 3: ثبت‌نام بعد از kill، وب هنوز روی pool stale → ok (self-healing کار کرد) ✓
  · TEST 4: ثبت‌نام دوم → ok (pool سالم است) ✓
  · TEST 5: ورود vvv بعد از stale pool → ok ✓
  · TEST 6: آیدی نامعتبر هنوز 422 (gate قبل از db) ✓
  · ۵/۵ سبز
- تست host-identity (Task 21 همچنان معتبر): ۷/۷ سبز — خطای قبلی مالک از stale pool می‌آمد، نه از منطق host identity
- tsc تمیز، eslint تمیز، next build موفق

Stage Summary:
- در «خطای ثبت آیدی»، کد بی‌گناه بود؛ زیرساخت بود: Prisma به inode مرده چسبیده بود
- وب‌سرور حالا خود-شفا‌بخش است: هر SQLite connection-level error، یک reset + retry شفاف، بدون 500 به کاربر
- الگوی Proxy-to-holder برای singleton hot-swap در ESM، یک ابزار تمیز برای هر Prisma-deployment که با SQLite کار می‌کند و فایلش ممکن است زیر پای پروسه عوض شود (backup/restore، kernel restart، migration)
- درس عملیاتی: «state را عوض کردی، پروسهٔ نگه‌دارنده‌اش را تازه کن» (Task 17) — حالا وب خودش این کار را می‌کند، بدون دخالت ادمین


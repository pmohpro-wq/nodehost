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

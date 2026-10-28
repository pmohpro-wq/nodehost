# NodeHost — نودهاست

<p align="center">
  <img src="public/logo.svg" alt="NodeHost" width="120" />
</p>

<p align="center">
  <strong>بستر میزبانی نودهای توزیع‌شده با معماری فدرال و پروتکل شبکه‌ای NHP</strong><br/>
  Distributed node hosting platform with a federated architecture and the NHP wire protocol.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
  <img src="https://img.shields.io/badge/protocol-NHP%20v1-blue" alt="NHP v1" />
  <img src="https://img.shields.io/badge/runtime-Bun-orange" alt="Bun" />
  <img src="https://img.shields.io/badge/UI-فارسی%20RTL-purple" alt="Persian RTL UI" />
</p>

---

## معرفی | Introduction

**NodeHost** نرم‌افزاری است برای میزبانی «نودها». هر نمونهٔ NodeHost می‌تواند از ۱ تا بی‌نهایت نود را — بسته به منابع سخت‌افزاری — روی خود نگه دارد. هر کاربر یک نود مستقل و کاملاً ایزوله برای خودش دارد و به‌عنوان **ادمینِ همان نود** تنها به نود خودش متصل می‌شود. ارتباط کاربران با یکدیگر همیشه از طریق نودهایشان انجام می‌شود، نه مستقیم.

**NodeHost** is a software platform for hosting *nodes*. A single NodeHost instance can carry anywhere from one to unbounded nodes, depending on hardware. Every user owns one isolated node and connects to it as its **admin**. Users always talk to each other *through their nodes* — never directly.

## فلسفهٔ معماری | Architecture Principles

1. **هر نود، یک شهروند شبکه** — همهٔ ارتباطات، حتی بین دو نود روی یک سرور، از طریق شبکه انجام می‌شود. نتیجه: حالت معنایی نود صرف‌نظر از اینکه روی کدام NodeHost اجرا شود، **کاملاً یکسان** است. هیچ نودی نمی‌داند همسایه‌اش «همسایهٔ محلی» است یا در قارهٔ دیگر قرار دارد.
2. **نود هرگز آفلاین نیست** — معماری بر این فرض طراحی شده که نودها همیشه روشن‌اند. ادمین ممکن است آفلاین شود (پیام‌ها برایش صف می‌شوند)، اما اگر نودی آفلاین شود، آن یک مشکل موقت فنی تلقی می‌شود و پروتکل با صف store-and-forward و retry خودکار آن را جبران می‌کند.
3. **ایزولاسیون کامل** — هر نود فضای نام، توکن، ماژول‌ها و storage مستقل خود را دارد.
4. **ماژول‌پذیری** — هر نود به‌صورت زنده تصمیم می‌گیرد کدام ماژول‌ها را فعال/غیرفعال کند؛ ماژول‌ها قطعات قابل‌تعویض نود هستند.
5. **اینترفیس، قرارداد است** — NodeHostهای مختلف با پیاده‌سازی‌های متفاوت، تا زمانی که پروتکل NHP و قرارداد ماژول را رعایت کنند، به‌راحتی به هم متصل می‌شوند.

> 1. **Every node is a first-class network citizen** — all traffic, even between two nodes on the same machine, flows over the network. A node's semantic state is therefore *identical* no matter which NodeHost it lives on.
> 2. **Nodes never go offline** — the architecture assumes nodes are always up. Admins may go offline (messages queue for them); a node being down is treated as a temporary technical fault, healed by the store-and-forward queue with automatic retries and dead-lettering.
> 3. **Full isolation** — every node owns its namespace, token, modules and storage.
> 4. **Modularity** — each node live-toggles which modules it runs; modules are swappable organs.
> 5. **The interface is the contract** — any NodeHost implementation that speaks NHP and honors the module contract federates seamlessly.

## ساختار پروژه | Project Layout

```
├── src/core/nodehost/          ← هستهٔ مشترک؛ مستقل از کتابخانه (dependency-free)
│   ├── protocol.ts             ← پاکت NHP v1: آدرس‌دهی host/node، ttl، replyTo، wildcard
│   ├── interfaces.ts           ← قرارداد متن‌باز: INodeModule / INodeContext / defineModule
│   └── modules/                ← ماژول‌های مرجع (chat، broadcast، presence، ping)
├── mini-services/nodehost-kernel/  ← هستهٔ اجرایی هر سرور (bun + socket.io + Prisma)
│   ├── kernel.ts               ← روتر: تحویل محلی / فوروارد HTTP + مکانیزم request/response همبسته
│   ├── federation.ts           ← لایهٔ بین‌میزبانی: transport، هارت‌بیت، صف retry با backoff نمایی
│   ├── runtime.ts              ← زمان‌اجرای ماژول با enable/disable زنده
│   ├── admin.ts                ← کنترل‌پلین REST + دیتاپلین /ingress (با احراز هویت اختیاری)
│   └── index.ts                ← دو listener (WS + API) و نقطهٔ registerModule
├── src/app/                    ← پنل کنترل فارسی RTL (Next.js + shadcn/ui)
├── prisma/schema.prisma        ← هر NodeHost = یک دیتابیس مستقل
└── scripts/start-kernels.sh    ← اجرای دو نودهاست فدرال (alfa و beta)
```

## پروتکل NHP v1 | The NHP Protocol

هر پیام در شبکه یک پاکت NHP است:

```ts
{
  envId:  "شناسهٔ یکتا (idempotency)",
  from:   "node-a1@alfa",     // <node>@<host>
  to:     "node-b1@beta",     // یا NHP_WILDCARD برای fan-out
  module: "chat",             // ماژول مقصد
  type:   "msg.post",
  payload: { ... },
  ttl:    8,                  // حداکثر پرش شبکه‌ای
  replyTo?: "msg-id"
}
```

- **آدرس‌دهی کامل** `node@host` — نود بدون توجه به مکان فیزیکی قابل نشانی‌گیری است.
- **wildcard fan-out** — ارسال به همهٔ نودهای میزبان یک ماژول (موزی برای همهٔ میزبان‌ها).
- **store-and-forward** — میزبان مقصد در دسترس نباشد، پیام تا ۶ بار با backoff نمایی (۷ → ۱۴ → ۲۸ → ۵۶ → ۱۱۲ ثانیه، سقف‌دار) retry می‌شود و سپس به dead-letter می‌رود.
- **هارت‌بیت فدرال** — میزبان‌ها هر ۸ ثانیه `sys.hello` رد و بدل می‌کنند و دایرکتوری نودها را همگام نگه می‌دارند.
- **امنیت لینک (اختیاری)** — با تنظیم `NHP_LINK_SECRET` (یک مقدار یکسان روی همهٔ میزبان‌ها)، `/ingress` فقط پاکت‌های دارای هدر `Authorization: Bearer <secret>` را می‌پذیرد (مقایسهٔ constant-time). بدون این متغیر، حالت باز حفظ می‌شود تا استقرارهای قبلی بدون تغییر کار کنند.
- **request/response همبسته** — ماژول‌ها علاوه بر `ctx.send` از `ctx.request(to, module, type, payload)` می‌توانند استفاده کنند: پاسخِ برگشتیِ ماژول مقصد (از طریق `replyTo`) به‌طور خودکار به فراخوان تحویل می‌شود؛ سقف انتظار پیش‌فرض ۱۰ ثانیه است.

## راه‌اندازی سریع | Quick Start

```bash
# ۱) نصب وابستگی‌ها
bun install

# ۲) دیتابیس‌ها
bunx prisma generate

# ۳) اجرای دو نودهاست فدرال (alfa: WS 3003 / API 3013 — beta: WS 3004 / API 3014)
bash scripts/start-kernels.sh

#    (اختیاری) امن‌سازی لینک بین میزبان‌ها — همان مقدار روی همهٔ سرورها:
#    NHP_LINK_SECRET="یک-راز-مشترک" bash scripts/start-kernels.sh

# ۴) پنل کنترل
bun dev          # http://localhost:3000
```

دو میزبان `alfa` و `beta` با دو دیتابیس جداگانه بالا می‌آیند و از همان لحظه به هم فدرال می‌شوند. برای دیدن صف‌بندی و recovery، میزبان سوم (gamma) را عمداً خاموش نگه دارید.

## ساخت ماژول جدید | Writing a Module

ماژول‌ها قلب توسعه‌پذیری NodeHost هستند. یک ماژول فقط یک شیء است که قرارداد `defineModule` را رعایت می‌کند:

```ts
import { defineModule } from "@/core/nodehost/interfaces";

export default defineModule({
  name: "greeter",
  version: "1.0.0",

  async onEnable(ctx) {
    ctx.log("greeter enabled on this node");
  },

  async onMessage(ctx, packet) {
    if (packet.type === "greet.hello") {
      await ctx.reply({ type: "greet.hi", payload: { hi: "salam!" } });
    }
  },
});
```

ثبت ماژول در هسته:

```ts
// mini-services/nodehost-kernel/index.ts
registerModule(greeterModule);
```

سپس از پنل کنترل، ماژول را برای هر نود به‌صورت زنده فعال/غیرفعال کنید. storage ماژول به‌صورت `per (node, module)` ایزوله است.

## نقاط افزونه‌پذیری | Extension Points

| نقطه | مسیر | کاربرد |
|------|------|--------|
| `registerModule` | `mini-services/nodehost-kernel/index.ts` | افزودن ماژول جدید |
| `/ingress` | HTTP روی پورت API هسته | اتصال میزبان‌های دیگر (فدراسیون) |
| `/api/nh/*` | پروکسی Next.js | برنامه‌های UI و ربات‌ها |
| `INodeContext` | `src/core/nodehost/interfaces.ts` | دسترسی ایزولهٔ ماژول به نود |

## مجوز | License

MIT — آزاد برای استفاده، تغییر و توسعه. ساخته‌شده به‌عنوان یک پروژهٔ متن‌باز برای رشد بلندمدت شبکهٔ نودها.

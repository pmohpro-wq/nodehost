'use client'

/**
 * ProtocolTab — living developer documentation (open-source contract).
 * Persian explanations + canonical English code blocks.
 */
import { SectionTitle, CodeBlock, StatusBadge } from './bits'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useNh } from './store'
import { BookOpenText, Boxes, Workflow, Waypoints, Server, Rocket } from 'lucide-react'

const ENVELOPE_SAMPLE = `{
  "nhp": 1,                          // protocol version — reject anything else
  "id": "3f9a…",                     // unique envelope id
  "type": "chat.message",            // namespaced action
  "module": "chat",                  // target module (or "sys")
  "from": { "host": "alfa", "node": "node-a1" },
  "to":   { "host": "beta", "node": "node-b1" },
  "ts": 1767000000000,
  "ttl": 8,                          // hop guard
  "payload": { "text": "سلام از آلفا!" },
  "replyTo": "…"                     // optional correlation id
}`

const MODULE_SAMPLE = `import { defineModule } from '@/core/nodehost/interfaces'
import { makeEnvelope, MODULE_TYPES } from '@/core/nodehost/protocol'

export default defineModule({
  id: 'my-iot',                      // unique module id
  name: 'IoT Bridge',
  version: '0.1.0',
  description: 'Reads sensor envelopes and replies with state',
  author: 'you',

  async onEnable(ctx) {
    await ctx.storage.set('bootAt', Date.now())   // private per-node KV
  },

  async onMessage(envelope, ctx) {
    if (envelope.type !== 'iot.read') return null
    // talk back to ANY node, on ANY host — pure networking:
    await ctx.send(
      { host: 'alfa', node: 'node-a1' },          // destination
      'my-iot', 'iot.state', { temp: 23.5 },
    )
    // or fan-out to every node that enabled 'my-iot':
    // await ctx.broadcast('my-iot', 'iot.state', { … })
    // or read the live directory:
    // const dir = await ctx.directory()
    return null  // (or return a reply envelope — kernel routes it)
  },
})`

const REGISTER_SAMPLE = `// mini-services/nodehost-kernel/index.ts
import myIotModule from '@/core/nodehost/modules/my-iot'
kernel.registerModule(myIotModule)   // that's it — UI picks it up automatically`

export function ProtocolTab() {
  const { data } = useNh()

  return (
    <div className="space-y-6">
      {/* Intro */}
      <div className="rounded-2xl border bg-gradient-to-bl from-emerald-500/10 via-transparent to-transparent p-5">
        <h2 className="text-lg font-extrabold flex items-center gap-2">
          <BookOpenText className="size-5 text-primary" />
          قرارداد متن‌باز نودهاست
        </h2>
        <p className="text-sm text-muted-foreground mt-2 leading-6 max-w-3xl">
          کل شبکه روی یک قرارداد ساده بنا شده است: <b>پاکت NHP</b> برای سیم‌کشی ارتباط و{' '}
          <b>INodeModule</b> برای برنامه‌نویسی ماژول‌ها. هر توسعه‌دهنده‌ای که این دو را رعایت کند،
          نودهایش با کل شبکه — فارق از میزبان و پیاده‌سازی — صحبت می‌کنند. نام‌گذاری کد و پروتکل
          لاتین است تا برای جامعهٔ متن‌باز جهانی خوانا بماند؛ توضیحات این صفحه فارسی است.
        </p>
      </div>

      {/* NHP envelope */}
      <section className="grid lg:grid-cols-2 gap-4">
        <div>
          <SectionTitle icon={<Waypoints />} title="پاکت NHP v1" sub="تنها واحد ارتباط روی سیم" />
          <CodeBlock>{ENVELOPE_SAMPLE}</CodeBlock>
          <ul className="text-xs text-muted-foreground mt-3 space-y-1.5 leading-5 list-disc pr-5">
            <li>آدرس‌دهی کامل <code dir="ltr" className="ltr-block">(host, node)</code> — نود محلی و نود راه‌دور هیچ تفاوت معنایی ندارند.</li>
            <li>هسته‌ها (kernel) فقط پاکت را مسیریابی می‌کنند؛ <code dir="ltr" className="ltr-block">payload</code> فقط برای ماژول مقصد معنا دارد.</li>
            <li>آدرس <code dir="ltr" className="ltr-block">*</code> یعنی همه (fan-out) — هستهٔ مبدأ به همهٔ میزبان‌های شناخته‌شده فوروارد می‌کند.</li>
            <li><code dir="ltr" className="ltr-block">ttl</code> جلوی حلقهٔ مسیریابی را می‌گیرد؛ <code dir="ltr" className="ltr-block">replyTo</code> درخواست/پاسخ را جفت می‌کند.</li>
          </ul>
        </div>

        {/* Message types */}
        <div>
          <SectionTitle icon={<Workflow />} title="نوع‌های پیام ماژول‌های دمو" sub="قرارداد payload هر ماژول" />
          <div className="rounded-xl border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="text-right px-3 py-2 font-medium">ماژول</th>
                  <th className="text-right px-3 py-2 font-medium">type</th>
                  <th className="text-right px-3 py-2 font-medium">payload</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {[
                  ['chat', 'chat.message', '{ text }'],
                  ['broadcast', 'broadcast.publish', '{ title, body, origin }'],
                  ['broadcast', 'broadcast.post', '{ title, body, origin }'],
                  ['ping', 'ping.request', '{ sentAt, note? }'],
                  ['ping', 'ping.reply', '{ sentAt, repliedAt, served }'],
                  ['presence', 'presence.query', '{}'],
                  ['presence', 'presence.roster', '{ requestedBy, at }'],
                  ['sys', 'sys.hello', '{ host, nodes[] } — heartbeat'],
                ].map(([m, t, p], i) => (
                  <tr key={i} className="hover:bg-muted/30">
                    <td className="px-3 py-2"><Badge variant="secondary" dir="ltr" className="ltr-block text-[10px]">{m}</Badge></td>
                    <td dir="ltr" className="px-3 py-2 ltr-block">{t}</td>
                    <td dir="ltr" className="px-3 py-2 ltr-block text-muted-foreground">{p}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Module dev guide */}
      <section className="grid lg:grid-cols-2 gap-4">
        <div>
          <SectionTitle icon={<Boxes />} title="نوشتن ماژول جدید" sub="INodeModule — تنها اینترفیسی که باید بشناسید" />
          <CodeBlock>{MODULE_SAMPLE}</CodeBlock>
        </div>
        <div>
          <SectionTitle icon={<Rocket />} title="ثبت در هسته" sub="دو خط کد" />
          <CodeBlock>{REGISTER_SAMPLE}</CodeBlock>
          <Card className="mt-4">
            <CardContent className="p-4 text-xs leading-6 space-y-2">
              <div className="font-semibold text-sm">تضمین‌های هسته به ماژول شما</div>
              <ul className="list-disc pr-4 text-muted-foreground space-y-1">
                <li><b className="text-foreground">ایزولاسیون:</b> ctx فقط متعلق به «یک نود» است؛ storage آرگومان‌های (node, module) جداست.</li>
                <li><b className="text-foreground">چرخهٔ گرم:</b> فعال/غیرفعال کردن از UI بلافاصله onEnable/onDisable را اجرا می‌کند.</li>
                <li><b className="text-foreground">تحویل تضمینی:</b> پاکت‌ها همیشه ذخیره می‌شوند؛ قطعی میزبان مقصد فقط صف می‌سازد.</li>
                <li><b className="text-foreground">بدون نشت:</b> ماژول به سوکت ادمین و دیتابیس دسترسی ندارد — فقط NHP.</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Endpoints */}
      <section>
        <SectionTitle icon={<Server />} title="قراردادهای سرویس‌دهی" sub="REST + WebSocket" />
        <div className="grid md:grid-cols-2 gap-3 text-xs">
          <Card>
            <CardContent className="p-4 space-y-2">
              <div className="font-semibold text-sm">نقاط پایانی شبکه (data-plane)</div>
              {[
                ['POST {host}/ingress', 'دروازهٔ پاکت‌های NHP بین هسته‌ها (و پاسخ hello با رستر)'],
              ].map(([a, b]) => (
                <div key={a} className="flex flex-col gap-0.5 rounded-lg border p-2.5">
                  <code dir="ltr" className="ltr-block text-[11px] font-semibold">{a}</code>
                  <span className="text-muted-foreground leading-5">{b}</span>
                </div>
              ))}
              <div className="font-semibold text-sm pt-1">پنل کنترل (control-plane — پروکسی Next.js)</div>
              {[
                ['GET /api/nh/bootstrap', 'وضعیت کامل میزبان + نودها + دایرکتوری + آمار'],
                ['POST /api/nh/nodes', 'ساخت نود (توکن ادمین برمی‌گردد)'],
                ['POST /api/nh/nodes/:id/modules', 'کلید فعال/غیرفعال ماژول'],
                ['POST /api/nh/hosts', 'ثبت میزبان راه‌دور + شروع هارت‌بیت'],
                ['GET /api/nh/mailbox/:nodeCode', 'صندوق ورودی نود'],
              ].map(([a, b]) => (
                <div key={a} className="flex flex-col gap-0.5 rounded-lg border p-2.5">
                  <code dir="ltr" className="ltr-block text-[11px] font-semibold">{a}</code>
                  <span className="text-muted-foreground leading-5">{b}</span>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 space-y-2">
              <div className="font-semibold text-sm">کانال ادمین (socket.io — فقط نودِ خودت)</div>
              {[
                ['admin:hello', '{ nodeCode, token } → welcome + mailbox'],
                ['nhp:send', '{ to, module, type, payload } → { envId, outcome }'],
                ['nhp:in', 'پاکت‌های ورودی نود (زنده)'],
                ['chat:history', '{ peerHost, peerNode } → تاریخچهٔ گفتگو'],
                ['broadcast:history', 'اعلان‌های دریافت‌شده'],
                ['mailbox:list / mailbox:clear', 'مدیریت صندوق'],
                ['net:refresh', 'هارت‌بیت فوری + دایرکتوری تازه'],
              ].map(([a, b]) => (
                <div key={a} className="flex flex-col gap-0.5 rounded-lg border p-2.5">
                  <code dir="ltr" className="ltr-block text-[11px] font-semibold">{a}</code>
                  <span className="text-muted-foreground leading-5">{b}</span>
                </div>
              ))}
              <div className="rounded-lg bg-muted/50 p-2.5 leading-5 text-muted-foreground">
                اتصال مرورگر: <code dir="ltr" className="ltr-block">io(&apos;/?XTransformPort={data?.host.gwPort ?? 3003}&apos;)</code> — هر ادمین فقط به سوکتِ میزبانِ نودِ خودش وصل می‌شود.
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Axiom mapping */}
      <section>
        <SectionTitle icon={<Workflow />} title="نگاشت اصول به پیاده‌سازی" sub="هر قانون، یک مکانیزم مشخص" />
        <div className="grid sm:grid-cols-2 gap-3 text-xs">
          {[
            ['نود هرگز آفلاین نمی‌شود', 'صف store-and-forward در جدول NhpMessage + حلقهٔ retry هر ۷ ثانیه تا ۶ تلاش، سپس dead-letter'],
            ['ادمین ممکن است آفلاین باشد', 'پیام‌های ورودی با status=queued در صندوق نود می‌مانند و هنگام admin:hello تحویل می‌شوند'],
            ['ارتباط صرفاً شبکه‌ای', 'مسیریابی فقط با (host, node)؛ تحویل محلی و فوروارد HTTP هیچ تفاوت معنایی ندارند'],
            ['فدراسیون میزبان‌ها', 'sys.hello هر ۸ ثانیه + تبادل رستر → دایرکتوری زنده در هر دو طرف'],
            ['ماژول‌های اختیاری', 'NodeModuleState per-node + ModuleRuntime با reconcile گرم'],
            ['استقلال کامل میزبان', 'هر نودهاست یک دیتابیس و یک هستهٔ مستقل — کشف همتاها فقط از طریق شبکه'],
          ].map(([t, b]) => (
            <div key={t} className="rounded-xl border p-3.5 space-y-1">
              <div className="font-semibold flex items-center gap-2">
                <StatusBadge status="online" label="اصل" />
                {t}
              </div>
              <p className="text-muted-foreground leading-5">{b}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

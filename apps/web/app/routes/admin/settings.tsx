import { ADMIN, SITE } from "@aihot/site";
import { useRef, useState } from "react";
import type { Route } from "./+types/settings";
import type { AdminSettings } from "@aihot/contracts/admin";
import { adminGet } from "../../lib/admin.server";
import { useAdminAction } from "../../features/admin/action";
import { bj, num } from "../../features/admin/format";
import { AdminPage, Badge, Button, Card, DataTable, Field, Input, ReasonDialog, Select, Textarea } from "../../features/admin/ui";
import { toast } from "../../features/admin/toast";


export async function loader({ request }: Route.LoaderArgs) {
  return adminGet<AdminSettings>(request, "/api/admin/settings");
}

export const meta: Route.MetaFunction = () => [{ title: `设置 · ${SITE.name} 后台` }];

function QrSlot({ slot, label, src }: { slot: "wechatQr" | "feishuQr"; label: string; src: string | null }) {
  const { run, pending } = useAdminAction();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-4">
      {src ? <img src={src} alt={label} className="size-28 rounded-card bg-white object-contain p-1.5 ring-1 ring-line" /> : <div className="flex size-28 shrink-0 items-center justify-center rounded-card bg-surface text-sm text-ink-4 ring-1 ring-line">未设置</div>}
      <div>
        <div className="text-[14px] font-medium text-ink">{label}</div>
        <div className="mt-0.5 break-all font-mono text-[11.5px] text-ink-4">{src}</div>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            if (file.size > 2 * 1024 * 1024) return toast("图片最大 2MB", "error");
            const image = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = reject;
              reader.readAsDataURL(file);
            });
            await run("POST", "/api/admin/settings/contact-qr", { slot, image }, { label: `qr-${slot}`, success: `${label}已更换，关于页 5 分钟内更新` });
          }}
        />
        <Button className="mt-2" size="sm" busy={pending === `qr-${slot}`} onClick={() => input.current?.click()}>更换图片</Button>
      </div>
    </div>
  );
}

function BudgetRow({ b }: { b: AdminSettings["budgets"][number] }) {
  const { run, pending } = useAdminAction();
  const [v, setV] = useState({ perMinute: b.per_minute, perHour: b.per_hour, perDay: b.per_day });
  const [open, setOpen] = useState(false);
  const changed = v.perMinute !== b.per_minute || v.perHour !== b.per_hour || v.perDay !== b.per_day;
  return (
    <tr className="border-b border-line/70 last:border-0">
      <td className="px-3 py-2 font-mono text-[12.5px]">{b.service}</td>
      {(["perMinute", "perHour", "perDay"] as const).map((k) => (
        <td key={k} className="px-3 py-2">
          <Input type="number" min={0} className="!w-24 !py-1 text-right" value={v[k]} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} />
        </td>
      ))}
      <td className="num px-3 py-2 text-right text-ink-3">{num(b.used_hour)} / {num(b.used_day)}</td>
      <td className="px-3 py-2 text-right">
        <Button size="sm" tone="primary" disabled={!changed} onClick={() => setOpen(true)}>保存</Button>
        <ReasonDialog
          open={open}
          title={`调整 ${b.service} 的请求上限`}
          description={`上限是付费请求的熔断：超过后请求暂停并按窗口重试。填 0 表示立即停用这个服务。${ADMIN.budgetNote ?? ""}`}
          confirmLabel="保存"
          busy={pending === "budget"}
          onClose={() => setOpen(false)}
          onSubmit={async (reason) => (await run("PUT", `/api/admin/budgets/${encodeURIComponent(b.service)}`, { ...v, reason }, { label: "budget", success: "上限已更新" })) !== null}
        />
      </td>
    </tr>
  );
}

function TargetToggle({ t }: { t: AdminSettings["targets"][number] }) {
  const { run, pending } = useAdminAction();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" tone={t.enabled ? "danger" : "primary"} onClick={() => setOpen(true)}>{t.enabled ? "停用" : "启用"}</Button>
      <ReasonDialog
        open={open}
        title={`${t.enabled ? "停用" : "启用"}：${t.note ?? t.key}`}
        description={t.enabled ? "停用后新的推送不再发往这个群。" : "启用时间会被记录：启用之前的内容不会补推。开发与彩排环境即使启用也不会真的发出。"}
        danger={t.enabled}
        confirmLabel={t.enabled ? "停用" : "启用"}
        busy={pending === "target"}
        onClose={() => setOpen(false)}
        onSubmit={async (reason) => (await run("POST", `/api/admin/notify-targets/${encodeURIComponent(t.key)}`, { enabled: !t.enabled, reason }, { label: "target", success: "已更新" })) !== null}
      />
    </>
  );
}

function ModelServiceCard({ m }: { m: AdminSettings["modelService"] }) {
  const { run, pending } = useAdminAction();
  const [v, setV] = useState({ baseUrl: m.baseUrl, model: m.model, apiKey: "" });
  const source = m.source === "admin" ? "后台已保存" : m.source === "env" ? "来自服务器配置" : "尚未配置";
  const tone = m.keySet ? "ok" : "warn";
  return (
    <Card
      title="模型服务"
      right={<Badge tone={tone}>{m.keySet ? source : "未配置密钥"}</Badge>}
    >
      <div className="space-y-3">
        <p className="text-[12.5px] leading-5 text-ink-3">
          采集不需要它；精选评分、摘要、事件归组和日报要用。保存后约 15 秒内对采集器与接口同时生效，不用重启。
        </p>
        <Field label="接口地址" hint="兼容 OpenAI 格式即可，例如 https://api.deepseek.com/v1 或 https://dashscope.aliyuncs.com/compatible-mode/v1">
          <Input value={v.baseUrl} onChange={(e) => setV({ ...v, baseUrl: e.target.value })} placeholder="https://api.deepseek.com/v1" />
        </Field>
        <Field label="模型名" hint="例如 deepseek-chat、qwen3.8-flash、glm-5.3-flash">
          <Input value={v.model} onChange={(e) => setV({ ...v, model: e.target.value })} placeholder="deepseek-chat" />
        </Field>
        <Field label="密钥" hint={m.keyHint ? `当前：${m.keyHint}。留空表示不改动，填新值则覆盖。` : "填上服务商给的 API Key，保存在数据库里，不回显。"}>
          <Input type="password" autoComplete="off" value={v.apiKey} onChange={(e) => setV({ ...v, apiKey: e.target.value })} placeholder={m.keySet ? "留空保持不变" : "sk-..."} />
        </Field>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            tone="primary"
            busy={pending === "model"}
            onClick={() => void run("POST", "/api/admin/settings/model-service", v, { label: "model", success: "已保存，约 15 秒内生效" })}
          >
            保存并生效
          </Button>
          {m.keySet ? (
            <Button tone="danger" busy={pending === "model-clear"} onClick={() => void run("POST", "/api/admin/settings/model-service", { ...v, clearKey: true }, { label: "model-clear", success: "密钥已清除" })}>
              清除密钥
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function AnalysisModeCard({ m }: { m: AdminSettings["modelService"] }) {
  const { run, pending } = useAdminAction();
  const [mode, setMode] = useState<"model" | "rules">(m.analysisMode);
  const rules = m.analysisMode === "rules";
  const changed = mode !== m.analysisMode;
  return (
    <Card title="分析方式" right={<Badge tone={rules ? "ok" : "muted"}>{rules ? "免费模式" : "模型模式"}</Badge>}>
      <div className="space-y-3">
        <p className="text-[12.5px] leading-5 text-ink-3">
          这一项决定每篇文章要不要花钱：采集本身都免费，只有甄别、评分、摘要和事件归组会调用模型。
          改完保存，约 15 秒内 api 与 worker 同时生效，不用重启。已经判过的文章保持原样，排队的按新方式处理。
        </p>
        <Field
          label="用哪种方式判断文章"
          hint="模型模式读得更准，会翻译标题、重写摘要、把同一件事的多篇报道归成一条事件；免费模式用关键词规则，不产生任何费用。"
        >
          <Select value={mode} onChange={(e) => setMode(e.target.value as "model" | "rules")}>
            <option value="model">模型模式（按 token 计费）</option>
            <option value="rules">免费模式（关键词规则，零费用）</option>
          </Select>
        </Field>
        <div className="rounded-card border border-line p-3 text-[12px] leading-5 text-ink-3">
          <div className="font-medium text-ink">免费模式的取舍</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            <li>标题保留信源原文，不翻译；摘要是正文开头，不是重写</li>
            <li>分类和标签按词表命中，比模型粗一些</li>
            <li>不做事件归组，日报退化成各篇标题的并列</li>
            <li>精选仍然有，按信源分级 + 关键词 + 时效打分，门槛和模型模式一样</li>
          </ul>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-4">
          <span>规则已判 {m.rulesArticles} 篇</span>
          <span>待判 {m.pendingArticles} 篇</span>
          <span>密钥 {m.keySet ? "已配置" : "未配置"}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            tone="primary"
            busy={pending === "mode"}
            disabled={!changed}
            onClick={() => void run("POST", "/api/admin/settings/analysis-mode", { mode }, { label: "mode", success: "已切换，约 15 秒内生效" })}
          >
            {changed ? "保存并生效" : "已是当前方式"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function ChannelRow({
  title,
  hint,
  note,
  ready,
  status,
  sources,
  children,
}: {
  title: string;
  hint: string;
  note: React.ReactNode;
  ready: boolean | null;
  status: string;
  sources: number;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-card border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[13.5px] font-medium text-ink">{title}</div>
        <div className="flex items-center gap-2">
          <Badge tone={ready === null ? "muted" : ready ? "ok" : "warn"}>{status}</Badge>
          <span className="text-[12px] text-ink-4">已启用 {sources} 个</span>
        </div>
      </div>
      <p className="mt-1 text-[12px] leading-5 text-ink-4">{hint}</p>
      <div className="mt-1 text-[12px] leading-5 text-ink-3">{note}</div>
      {children}
    </div>
  );
}

function ChannelsCard({ c, endpoint }: { c: AdminSettings["channels"]; endpoint: string }) {
  const { run, pending } = useAdminAction();
  const [v, setV] = useState({ dajialaKey: "", socialdataKey: "" });
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast("已复制");
    } catch {
      toast("复制失败，手动选中复制", "error");
    }
  };
  return (
    <Card title="采集通道" right={<span>四种入口，按需开启</span>}>
      <div className="space-y-3">
        <ChannelRow
          title="微信公众号"
          ready={c.mp.ready}
          status={c.mp.ready ? (c.mp.source === "admin" ? "后台已保存" : "来自服务器配置") : "待填密钥"}
          sources={c.mp.sources}
          hint="走极致了的接口，列一次该号最近文章 0.14 元、取一篇正文 0.03 元。抓取间隔在信源里设，间隔越短越贵。"
          note={c.mp.hint ? `当前密钥：${c.mp.hint}，留空不改动。` : "公众号原始 ID（gh_ 开头）要写在信源的配置里。"}
        >
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Input className="!w-72" type="password" autoComplete="off" placeholder="极致了的 key" value={v.dajialaKey} onChange={(e) => setV({ ...v, dajialaKey: e.target.value })} />
            {c.mp.ready ? (
              <Button size="sm" tone="danger" busy={pending === "ch-mp-clear"} onClick={() => void run("POST", "/api/admin/settings/channel-keys", { clear: ["mp"] }, { label: "ch-mp-clear", success: "公众号密钥已清除" })}>
                清除
              </Button>
            ) : null}
          </div>
        </ChannelRow>

        <ChannelRow
          title="X 账号"
          ready={c.x.ready}
          status={c.x.ready ? (c.x.source === "admin" ? "后台已保存" : "来自服务器配置") : "待填密钥"}
          sources={c.x.sources}
          hint="走 SocialData 的搜索接口，按次计费。同类账号会自动合并成一次搜索，省请求数。"
          note={c.x.hint ? `当前密钥：${c.x.hint}，留空不改动。` : "关注名单写在信源的查询语句里。"}
        >
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Input className="!w-72" type="password" autoComplete="off" placeholder="SocialData 的 key" value={v.socialdataKey} onChange={(e) => setV({ ...v, socialdataKey: e.target.value })} />
            {c.x.ready ? (
              <Button size="sm" tone="danger" busy={pending === "ch-x-clear"} onClick={() => void run("POST", "/api/admin/settings/channel-keys", { clear: ["x"] }, { label: "ch-x-clear", success: "X 密钥已清除" })}>
                清除
              </Button>
            ) : null}
          </div>
        </ChannelRow>

        <ChannelRow
          title="网页列表"
          ready={null}
          status="不需要密钥"
          sources={c.web.sources}
          hint="免费。给每个站配列表项、标题、链接和日期的选择器；中文站现在多是 JS 渲染，抓下来可能是空壳，先在信源页试抓一次。"
          note={
            <>
              到 <a className="underline" href="/admin/sources/new">信源页</a> 新建，类型选「网页列表」。
            </>
          }
        />

        <ChannelRow
          title="外部推送"
          ready={null}
          status={c.ingest.token ? "口令已生成" : "待生成口令"}
          sources={c.ingest.sources}
          hint="免费。你自己的脚本把标题、链接、摘要 POST 过来，就能变成一条待精选的内容。"
          note={<>POST 到 <span className="break-all font-mono text-[11.5px]">{endpoint}</span>，请求头带 Bearer 口令。</>}
        >
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {c.ingest.token ? (
              <>
                <code className="max-w-full break-all rounded bg-surface px-2 py-1 font-mono text-[11.5px] text-ink-3">{c.ingest.token}</code>
                <Button size="sm" onClick={() => void copy(c.ingest.token!)}>复制</Button>
                <Button size="sm" busy={pending === "ch-ingest"} onClick={() => void run("POST", "/api/admin/settings/channel-keys", { generateIngest: true }, { label: "ch-ingest", success: "已生成新口令，旧口令立即失效" })}>
                  重新生成
                </Button>
              </>
            ) : (
              <Button size="sm" tone="primary" busy={pending === "ch-ingest"} onClick={() => void run("POST", "/api/admin/settings/channel-keys", { generateIngest: true }, { label: "ch-ingest", success: "口令已生成" })}>
                生成推送口令
              </Button>
            )}
          </div>
        </ChannelRow>

        <div className="flex items-center gap-2 pt-1">
          <Button
            tone="primary"
            busy={pending === "ch-save"}
            disabled={!v.dajialaKey && !v.socialdataKey}
            onClick={async () => {
              const ok = await run("POST", "/api/admin/settings/channel-keys", v, { label: "ch-save", success: "已保存，约 15 秒内生效" });
              if (ok !== null) setV({ dajialaKey: "", socialdataKey: "" });
            }}
          >
            保存密钥
          </Button>
          <span className="text-[12px] text-ink-4">保存后采集器与定时任务同时认，不用重启</span>
        </div>
      </div>
    </Card>
  );
}

function ChangelogCard({ c }: { c: AdminSettings["changelog"] }) {
  const { run, pending } = useAdminAction();
  const stamp = new Date(Date.now() + 8 * 3600_000).toISOString();
  const [v, setV] = useState({ date: stamp.slice(0, 10), time: stamp.slice(11, 16), kind: "更新" as AdminSettings["changelog"]["admin"][number]["kind"], title: "", body: "" });
  const lines = v.body.split("\n").map((s) => s.trim()).filter(Boolean);
  const ready = v.title.trim().length > 0;
  return (
    <Card title="更新日志" right={<span>随站点发布的 {c.shipped} 条不可在此删除</span>}>
      <div className="grid gap-3 md:grid-cols-6">
        <Field label="日期"><Input type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></Field>
        <Field label="时间"><Input type="time" value={v.time} onChange={(e) => setV({ ...v, time: e.target.value })} /></Field>
        <Field label="类型">
          <Select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as typeof v.kind })}>
            <option value="更新">更新</option>
            <option value="优化">优化</option>
            <option value="公告">公告</option>
            <option value="下线">下线</option>
          </Select>
        </Field>
        <div className="md:col-span-3">
          <Field label="标题"><Input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder="例如：主题页新增价格走势" /></Field>
        </div>
        <div className="md:col-span-6">
          <Field label="正文" hint="一行一条，会按顺序显示在这条记录下">
            <Textarea rows={3} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} placeholder={"新增硅料与电池片价格走势图\n修复移动端表格横向滚动"} />
          </Field>
        </div>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <Button
          tone="primary"
          disabled={!ready}
          busy={pending === "changelog-add"}
          onClick={async () => {
            const ok = await run("POST", "/api/admin/settings/changelog", { ...v, body: lines }, { label: "changelog-add", success: "已发布到更新日志" });
            if (ok !== null) setV({ ...v, title: "", body: "" });
          }}
        >
          发布这条
        </Button>
        <span className="text-[12px] text-ink-4">发布后读者侧 5 分钟内更新</span>
      </div>
      <div className="mt-4">
        <DataTable
          rows={c.admin}
          rowKey={(r) => `${r.date}-${r.time}-${r.title}`}
          empty="还没有从后台发布过记录"
          columns={[
            { key: "t", label: "时间", render: (r) => <span className="font-mono text-[12px]">{r.date} {r.time}</span> },
            { key: "k", label: "类型", render: (r) => <Badge>{r.kind}</Badge> },
            { key: "n", label: "标题", render: (r) => <div><div className="font-medium text-ink">{r.title}</div>{r.body.length ? <div className="mt-0.5 line-clamp-2 text-[12px] text-ink-3">{r.body.join("；")}</div> : null}</div> },
            {
              key: "a",
              label: "",
              align: "right",
              render: (r) => (
                <Button size="sm" tone="danger" busy={pending === `changelog-del-${r.title}`} onClick={() => void run("POST", "/api/admin/settings/changelog/delete", { date: r.date, time: r.time, title: r.title }, { label: `changelog-del-${r.title}`, success: "已删除" })}>
                  删除
                </Button>
              ),
            },
          ]}
        />
      </div>
    </Card>
  );
}

export default function SettingsAdmin({ loaderData: s }: Route.ComponentProps) {
  return (
    <AdminPage title="设置" subtitle="不改代码即可替换的运营设置。每次修改都写入审计记录。">
      <div className="grid gap-5 xl:grid-cols-2">
        <AnalysisModeCard m={s.modelService} />
        <ModelServiceCard m={s.modelService} />
        <ChannelsCard c={s.channels} endpoint={s.channels.ingest.endpoint} />
        <Card title="关于页二维码">
          <div className="space-y-5">
            <QrSlot slot="wechatQr" label="微信公众号二维码" src={s.contact.wechatQr} />
            <QrSlot slot="feishuQr" label="飞书群二维码" src={s.contact.feishuQr} />
          </div>
        </Card>
        <Card title="通知目的地" pad={false}>
          <DataTable
            rows={s.targets}
            rowKey={(t) => t.key}
            columns={[
              { key: "k", label: "目的地", render: (t) => <div><div className="font-medium text-ink">{t.note ?? t.key}</div><div className="font-mono text-[11.5px] text-ink-4">{t.key} · {t.config_ref}</div></div> },
              { key: "e", label: "状态", render: (t) => (t.enabled ? <Badge tone="ok">启用于 {bj(t.enabled_at)}</Badge> : <Badge>停用</Badge>) },
              { key: "d", label: "7 天投递", align: "right", render: (t) => num(t.deliveries_7d) },
              { key: "a", label: "", align: "right", render: (t) => <TargetToggle t={t} /> },
            ]}
          />
        </Card>
      </div>
      <Card className="mt-5" title="付费请求上限" right={<span>已用：近 1 小时 / 近 24 小时</span>} pad={false}>        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[12px] text-ink-3">
                <th className="px-3 py-2 font-medium">服务</th>
                <th className="px-3 py-2 font-medium">每分钟</th>
                <th className="px-3 py-2 font-medium">每小时</th>
                <th className="px-3 py-2 font-medium">每天</th>
                <th className="px-3 py-2 text-right font-medium">已用</th>
                <th />
              </tr>
            </thead>
            <tbody>{s.budgets.map((b) => <BudgetRow key={`${b.service}-${b.updated_at}`} b={b} />)}</tbody>
          </table>
        </div>
      </Card>
      <div className="mt-5">
        <ChangelogCard c={s.changelog} />
      </div>
    </AdminPage>
  );
}

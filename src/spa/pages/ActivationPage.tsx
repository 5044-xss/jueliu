import { ShieldAlert, ShieldCheck, WifiOff } from "lucide-react";
import type { LocalLicenseState } from "../license/service";
import { ActivationForm } from "../license/ActivationForm";
import { formatDateTime } from "../license/format";
import { useLicense } from "../license/use-license";

function descriptionOf(state: LocalLicenseState): string {
  if (state.allowed) {
    return "当前授权有效。如需更换授权，直接粘贴新的激活码即可。";
  }
  switch (state.status) {
    case "pending":
      return `授权将于 ${formatDateTime(state.nbf)} 生效，到时间后点击“检查授权”即可。`;
    case "expired":
      return "授权或试用已结束。续期后点击“检查授权”即可恢复使用。";
    case "revoked":
      return "该授权已被吊销，本地授权状态已清除。请联系卖家处理。";
    case "invalid":
    case "error":
      return state.message || "激活码无效，请确认激活码与当前机器码匹配。";
    default:
      return "本机尚未授权。请将机器码发送给卖家获取激活码，或申请试用。";
  }
}

function Callout({ state }: { state: LocalLicenseState }) {
  const pending = state.status === "pending";
  const failed = state.status === "error" || (!state.allowed && state.offline);
  const active = state.allowed;
  const Icon = active ? ShieldCheck : failed ? WifiOff : ShieldAlert;

  const tone = active
    ? "border-emerald-600/20 bg-emerald-600/5 text-emerald-700"
    : pending
      ? "border-amber-500/25 bg-amber-500/5 text-amber-700"
      : failed
        ? "border-border bg-surface-soft text-muted-foreground"
        : "border-destructive/20 bg-destructive/5 text-destructive";

  return (
    <div
      className={`mt-4 flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm ${tone}`}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="break-words text-foreground">
          {state.message || "未知授权状态"}
        </div>
        {state.error &&
          state.error !== state.message &&
          !state.error.startsWith(state.message) && (
            <div className="mt-1 break-words font-mono text-[10.5px] text-muted-foreground">
              {state.error}
            </div>
          )}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-muted-foreground">
          {pending && state.nbf && (
            <span>生效时间 {formatDateTime(state.nbf)}</span>
          )}
          {state.exp && <span>到期时间 {formatDateTime(state.exp)}</span>}
          {state.sn && <span className="font-mono">{state.sn}</span>}
          {state.offline && <span>离线校验</span>}
        </div>
      </div>
    </div>
  );
}

export function ActivationPage() {
  const license = useLicense();

  return (
    <div className="h-dvh min-h-0 overflow-y-auto bg-surface-soft">
      <div className="mx-auto flex min-h-full w-full max-w-xl flex-col justify-center px-5 py-10">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-xl bg-primary text-base font-bold text-primary-foreground">
            掘
          </div>
          <div>
            <div className="text-lg font-semibold tracking-tight">掘流</div>
            <div className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
              License Activation
            </div>
          </div>
        </div>

        <div className="rounded-[20px] border border-border bg-card p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-colors hover:border-foreground/20 sm:p-8">
          <span className="font-mono text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            Authorization
          </span>
          <h1 className="mt-2 text-2xl font-light tracking-tight">激活掘流</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {descriptionOf(license)}
          </p>

          <Callout state={license} />

          <div className="mt-6 border-t border-border pt-6">
            <ActivationForm autoFocus />
          </div>

          <p className="mt-6 border-t border-border pt-4 text-[11px] leading-relaxed text-muted-foreground">
            授权与机器码绑定，一码一机。更换硬件后请联系卖家重新签发，客户端不提供自助换绑。
          </p>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => string;
      remove: (widgetId: string) => void;
    };
  }
}

const scriptId = "cloudflare-turnstile-script";

export function Turnstile({ onVerify }: { onVerify: (token: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | undefined>(undefined);
  const sitekey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

  useEffect(() => {
    if (!sitekey) return;
    const render = () => {
      if (!container.current || !window.turnstile || widgetId.current) return;
      widgetId.current = window.turnstile.render(container.current, {
        sitekey,
        action: "turnstile-spin-v2",
        callback: onVerify,
        "expired-callback": () => onVerify(""),
        "error-callback": () => onVerify("")
      });
    };
    let script = document.getElementById(scriptId) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script");
      script.id = scriptId;
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    script.addEventListener("load", render);
    render();
    return () => {
      script?.removeEventListener("load", render);
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = undefined;
    };
  }, [onVerify, sitekey]);

  if (!sitekey) return <p className="error" role="alert">Turnstile 尚未配置，暂时无法提交任务。</p>;
  return <div ref={container} className="turnstile" data-action="turnstile-spin-v2"/>;
}

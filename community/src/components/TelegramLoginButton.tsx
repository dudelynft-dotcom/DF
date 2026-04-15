"use client";
import { useEffect, useRef } from "react";

// Embeds the official Telegram Login Widget.
//
// The widget is a third-party script (telegram.org/js/telegram-widget.js)
// that renders a button. When the user authorises, Telegram calls
// window[callback](userPayload) with the signed payload.
//
// We don't trust the payload on the client — we POST it to
// /api/community/link-telegram where the backend verifies the
// HMAC-SHA256 signature with the bot token.

type TgPayload = {
  id: number; first_name?: string; last_name?: string;
  username?: string; photo_url?: string;
  auth_date: number; hash: string;
};

declare global {
  interface Window {
    __dfOnTgAuth?: (u: TgPayload) => void;
  }
}

export function TelegramLoginButton({
  botUsername, onLinked, disabled,
}: {
  botUsername: string;
  onLinked: (u: { id: string; username: string | null }) => void;
  disabled?: boolean;
}) {
  const slot = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);

  useEffect(() => {
    if (!slot.current || mounted.current || disabled) return;
    mounted.current = true;

    // Global callback the widget invokes with the signed user payload.
    window.__dfOnTgAuth = async (u) => {
      try {
        const res = await fetch("/api/community/link-telegram", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tg: u }),
        });
        const j = await res.json();
        if (!res.ok) {
          alert(`Telegram link failed: ${j?.error ?? res.status}`);
          return;
        }
        onLinked({ id: String(j.tgUserId), username: j.tgUsername ?? null });
      } catch (e: unknown) {
        alert(`Network error: ${(e as Error).message}`);
      }
    };

    const s = document.createElement("script");
    s.src = "https://telegram.org/js/telegram-widget.js?22";
    s.async = true;
    s.setAttribute("data-telegram-login", botUsername);
    s.setAttribute("data-size", "medium");
    s.setAttribute("data-radius", "6");
    s.setAttribute("data-request-access", "write"); // optional, lets bot DM
    s.setAttribute("data-onauth", "__dfOnTgAuth(user)");
    slot.current.appendChild(s);

    return () => {
      if (slot.current) slot.current.innerHTML = "";
      delete window.__dfOnTgAuth;
      mounted.current = false;
    };
  }, [botUsername, disabled, onLinked]);

  return (
    <div>
      <div ref={slot} className={disabled ? "opacity-50 pointer-events-none" : ""} />
    </div>
  );
}

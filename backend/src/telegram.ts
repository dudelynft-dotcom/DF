// Telegram verification primitives.
//
// We use two bits of Telegram infrastructure:
//
//   1. Telegram Login Widget — an official server-side-verifiable auth
//      flow. The widget hands us (id, first_name, username, auth_date,
//      hash). We recompute the hash and compare to prove the widget
//      response wasn't forged client-side.
//
//   2. Bot API getChatMember(chat, user_id) — returns the membership
//      status of a specific Telegram user in a chat. We treat any
//      status other than "left" / "kicked" as joined.
//
// Requires a Telegram bot (created with @BotFather). The bot must be
// added to the channel/group we want to verify. Public channels
// require the bot to be admin; public groups allow member.

import crypto from "node:crypto";

export type TgLoginPayload = {
  id: number | string;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number | string;
  hash: string;
};

function botToken(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error("TELEGRAM_BOT_TOKEN not set");
  return t;
}

/// Verify the signature on a Telegram Login Widget response.
/// Returns the cleaned payload on success, or null on any failure
/// (bad hash, expired, malformed).
export function verifyTgLogin(p: TgLoginPayload): { id: string; username?: string; firstName?: string } | null {
  if (!p?.hash || p.id == null || p.auth_date == null) return null;

  // Freshness — reject widget responses older than 24h. Replay cap.
  const ageSec = Math.floor(Date.now() / 1000) - Number(p.auth_date);
  if (!Number.isFinite(ageSec) || ageSec < 0 || ageSec > 24 * 3600) return null;

  // Telegram login signature scheme:
  //   secret_key = SHA256(bot_token)
  //   data_check_string = sorted "key=value" pairs joined by "\n"
  //     (exclude `hash`; include every other field that's present)
  //   expected_hash = HMAC_SHA256(secret_key, data_check_string)
  const entries: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(p)) {
    if (k === "hash") continue;
    if (v == null) continue;
    entries.push([k, String(v)]);
  }
  entries.sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join("\n");

  const secret = crypto.createHash("sha256").update(botToken()).digest();
  const expected = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");

  const got = p.hash;
  if (got.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(got, "hex"), Buffer.from(expected, "hex"))) return null;
  } catch { return null; }

  return { id: String(p.id), username: p.username, firstName: p.first_name };
}

/// Returns true if the given tg user is currently a member of the chat.
/// `chat` is either a numeric chat_id or a public @username.
export async function isChatMember(chat: string, tgUserId: string): Promise<boolean> {
  const u = new URL(`https://api.telegram.org/bot${botToken()}/getChatMember`);
  u.searchParams.set("chat_id", chat);
  u.searchParams.set("user_id", tgUserId);
  const res = await fetch(u);
  const j = await res.json() as { ok: boolean; result?: { status: string }; description?: string };
  if (!j.ok) {
    console.error("[tg] getChatMember", chat, tgUserId, j.description);
    return false;
  }
  const status = j.result?.status;
  // "creator" | "administrator" | "member" | "restricted" | "left" | "kicked"
  return status !== undefined && status !== "left" && status !== "kicked";
}

export function tgBotUsername(): string | null {
  // Set by the caller in env so the UI can render the Login Widget.
  return process.env.TELEGRAM_BOT_USERNAME ?? null;
}

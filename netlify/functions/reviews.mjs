// Функция отзывов (Netlify Functions v2 + Netlify Blobs).
// GET               → список опубликованных отзывов
// GET ?id&action&sig → модерация по ссылке из Telegram (опубликовать / удалить)
// POST              → новый отзыв (сохраняется как «на проверке», вам приходит сообщение в Telegram)
//
// Нужны переменные Netlify: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, MODERATION_SECRET.

import { getStore } from "@netlify/blobs";
import { createHmac, timingSafeEqual } from "node:crypto";

const clean = (s, max) => String(s || "").replace(/\s+/g, " ").trim().slice(0, max);
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const sign = (id, action) =>
  createHmac("sha256", process.env.MODERATION_SECRET).update(id + ":" + action).digest("hex");
const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extra },
  });
const page = (text) =>
  new Response(
    "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>" +
      "<body style='font:22px system-ui;padding:40px'>" + esc(text),
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  );

export default async (req) => {
  const store = getStore("reviews");
  const url = new URL(req.url);

  if (req.method === "GET") {
    const id = url.searchParams.get("id");

    // Модерация по ссылке из Telegram
    if (id) {
      const action = url.searchParams.get("action");
      const sig = url.searchParams.get("sig") || "";
      if (
        !process.env.MODERATION_SECRET ||
        !/^r-\d+-[a-z0-9]+$/.test(id) ||
        !["approve", "delete"].includes(action)
      ) {
        return page("Ссылка недействительна.");
      }
      const a = Buffer.from(sig);
      const b = Buffer.from(sign(id, action));
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        return page("Ссылка недействительна.");
      }
      const review = await store.get(id, { type: "json" });
      if (!review) return page("Отзыв уже обработан.");
      if (action === "approve") {
        review.status = "approved";
        await store.setJSON(id, review);
        return page("Отзыв опубликован на сайте.");
      }
      await store.delete(id);
      return page("Отзыв удалён.");
    }

    // Список опубликованных
    const { blobs } = await store.list();
    const all = await Promise.all(blobs.map((x) => store.get(x.key, { type: "json" })));
    const list = all
      .filter((r) => r && r.status === "approved")
      .sort((x, y) => y.createdAt - x.createdAt)
      .slice(0, 30)
      .map(({ name, rating, text, createdAt }) => ({ name, rating, text, createdAt }));
    return json(list, 200, { "Cache-Control": "no-store" });
  }

  if (req.method === "POST") {
    let d;
    try {
      d = await req.json();
    } catch (e) {
      return json({ error: "bad json" }, 400);
    }
    if (d.website) return json({ ok: true }); // ловушка для ботов

    if (
      !process.env.MODERATION_SECRET ||
      !process.env.TELEGRAM_BOT_TOKEN ||
      !process.env.TELEGRAM_CHAT_ID
    ) {
      console.log("Не заданы переменные окружения");
      return json({ error: "not configured" }, 500);
    }

    const name = clean(d.name, 40);
    const text = clean(d.text, 500);
    const rating = Number(d.rating);
    if (name.length < 2 || text.length < 10 || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      return json({ error: "invalid" }, 400);
    }

    // Защита от переполнения: не больше 300 записей всего
    const { blobs } = await store.list();
    if (blobs.length >= 300) return json({ error: "too many" }, 429);

    const id = "r-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
    await store.setJSON(id, { name, rating, text, status: "pending", createdAt: Date.now() });

    const link = (action) =>
      url.origin + "/.netlify/functions/reviews?id=" + id + "&action=" + action + "&sig=" + sign(id, action);

    const msg =
      "📝 <b>Новый отзыв на проверку</b>\n\n👤 " + esc(name) + "\n" + "⭐".repeat(rating) + "\n💬 " + esc(text);

    try {
      const res = await fetch(
        "https://api.telegram.org/bot" + process.env.TELEGRAM_BOT_TOKEN + "/sendMessage",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: process.env.TELEGRAM_CHAT_ID,
            text: msg,
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "✅ Опубликовать", url: link("approve") },
                  { text: "🗑 Удалить", url: link("delete") },
                ],
              ],
            },
          }),
        }
      );
      if (!res.ok) console.log("Telegram error:", res.status, await res.text());
    } catch (e) {
      console.log("Telegram fetch failed:", e.message);
    }
    return json({ ok: true });
  }

  return new Response("Method Not Allowed", { status: 405 });
};

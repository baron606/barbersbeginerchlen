// Эта функция запускается на серверах Netlify, когда форма отправляет заявку.
// Токен бота и ID чата берутся из переменных окружения (их вы задаёте в настройках Netlify),
// поэтому в коде сайта секретов нет.

const esc = (s) =>
  String(s || '').slice(0, 300).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: 'Bad JSON' };
  }

  // Скрытое поле-ловушка: человек его не видит, а спам-боты заполняют
  if (data.website) {
    return { statusCode: 200, body: 'ok' };
  }

  if (!data.name || !data.phone || !data.date || !data.time) {
    return { statusCode: 400, body: 'Missing fields' };
  }

  const text =
    '✂️ <b>Новая запись</b>\n\n' +
    '👤 Имя: ' + esc(data.name) + '\n' +
    '📞 Телефон: ' + esc(data.phone) + '\n' +
    '💈 Услуга: ' + esc(data.service) + '\n' +
    '📅 Дата: ' + esc(data.date) + '\n' +
    '🕒 Время: ' + esc(data.time) +
    (data.comment ? '\n💬 Комментарий: ' + esc(data.comment) : '');

  const url = 'https://api.telegram.org/bot' + process.env.TELEGRAM_BOT_TOKEN + '/sendMessage';

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: text,
        parse_mode: 'HTML'
      })
    });
    if (!res.ok) {
      return { statusCode: 502, body: 'Telegram error' };
    }
    return { statusCode: 200, body: 'ok' };
  } catch (e) {
    return { statusCode: 500, body: 'Server error' };
  }
};

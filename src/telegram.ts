import { config } from './config';
import type { ReceiptSnapshot, ScanSummary } from './types';

export async function sendTelegramMessage(text: string): Promise<void> {
  if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID) {
    throw new Error('Telegram credentials are not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.');
  }

  const response = await fetch(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: config.TELEGRAM_CHAT_ID,
      text,
      disable_notification: config.TELEGRAM_SILENT,
      parse_mode: 'HTML'
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telegram send failed: ${response.status} ${body}`);
  }
}

export function buildNewReceiptsMessage(summary: ScanSummary): string {
  const lines = [
    '<b>kvartplata.online</b>',
    `Найдено новых квитанций: <b>${summary.newReceipts.length}</b>`,
    ''
  ];

  for (const receipt of summary.newReceipts) {
    lines.push(formatReceipt(receipt));
  }

  lines.push('', `Проверка завершена: ${summary.finishedAt}`);
  return lines.join('\n');
}

export function buildNeedsLoginMessage(summary: ScanSummary): string {
  return [
    '⚠️ <b>kvartplata.online требует ручной вход</b>',
    'Автоматический вход не выполняется намеренно.',
    'Нужно запустить bootstrap и вручную пройти логин/капчу, чтобы обновить сохраненную сессию.',
    '',
    `Последний статус: ${summary.message}`,
    `Время: ${summary.finishedAt}`
  ].join('\n');
}

function formatReceipt(receipt: ReceiptSnapshot): string {
  const suffix = receipt.receiptAvailable
    ? receipt.receiptDownloaded
      ? 'PDF: downloaded'
      : 'PDF: available'
    : 'PDF: not detected';

  return `• ${escapeHtml(receipt.accountExternalId)} — ${escapeHtml(receipt.monthLabel)} — ${escapeHtml(receipt.amountText)}${receipt.statusText ? ` — ${escapeHtml(receipt.statusText)}` : ''} — ${suffix}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char] ?? char));
}

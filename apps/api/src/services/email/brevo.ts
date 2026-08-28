/**
 * Transactional email via Brevo.
 *
 * Account verification is the reason this exists: SIAB requires a real,
 * verified address before a user can transact. When Brevo is not configured
 * the calls degrade to a logged no-op rather than throwing, so the app is
 * usable in development without a key — but `emailConfigured()` reports the
 * truth so the health endpoint does not claim otherwise.
 */
import { emailConfigured, loadEnv } from '../../env.js';

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

export interface SendEmailInput {
  to: { email: string; name?: string };
  subject: string;
  html: string;
  text?: string;
}

export interface SendResult {
  sent: boolean;
  reason?: string;
  messageId?: string;
}

export async function sendEmail(input: SendEmailInput): Promise<SendResult> {
  const env = loadEnv();
  if (!emailConfigured(env)) {
    return { sent: false, reason: 'BREVO_API_KEY is not set' };
  }

  const res = await fetch(BREVO_ENDPOINT, {
    method: 'POST',
    headers: {
      'api-key': env.BREVO_API_KEY as string,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { email: env.BREVO_SENDER_EMAIL, name: env.BREVO_SENDER_NAME },
      to: [input.to],
      subject: input.subject,
      htmlContent: input.html,
      ...(input.text ? { textContent: input.text } : {}),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { sent: false, reason: `Brevo responded ${res.status}: ${body.slice(0, 200)}` };
  }

  const json = (await res.json().catch(() => ({}))) as { messageId?: string };
  return { sent: true, messageId: json.messageId };
}

/** Shared shell so every SIAB email looks like SIAB. White and cyan. */
function shell(bodyHtml: string, dir: 'ltr' | 'rtl'): string {
  return `<!doctype html><html dir="${dir}"><body style="margin:0;padding:24px;background:#F8FAFC;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0F172A">
  <div style="max-width:520px;margin:0 auto;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:16px;overflow:hidden">
    <div style="background:#06B6D4;padding:20px 24px">
      <span style="color:#FFFFFF;font-size:20px;font-weight:700;letter-spacing:0.5px">SIAB</span>
    </div>
    <div style="padding:24px">${bodyHtml}</div>
    <div style="padding:16px 24px;border-top:1px solid #E2E8F0;color:#64748B;font-size:12px">
      SIAB — a marketplace connecting buyers and sellers.
    </div>
  </div></body></html>`;
}

export async function sendVerificationEmail(
  to: string,
  link: string,
  locale: 'en' | 'ar' = 'en',
): Promise<SendResult> {
  const ar = locale === 'ar';
  const body = ar
    ? `<h1 style="font-size:20px;margin:0 0 12px">فعّل حسابك في صياب</h1>
       <p style="margin:0 0 20px;color:#334155;line-height:1.6">اضغط على الزر أدناه لتفعيل بريدك الإلكتروني والبدء في استخدام صياب.</p>
       <a href="${link}" style="display:inline-block;background:#06B6D4;color:#fff;padding:12px 24px;border-radius:12px;text-decoration:none;font-weight:600">تفعيل الحساب</a>
       <p style="margin:20px 0 0;color:#64748B;font-size:13px">إذا لم تنشئ هذا الحساب، تجاهل هذه الرسالة.</p>`
    : `<h1 style="font-size:20px;margin:0 0 12px">Verify your SIAB account</h1>
       <p style="margin:0 0 20px;color:#334155;line-height:1.6">Tap the button below to verify your email and start using SIAB.</p>
       <a href="${link}" style="display:inline-block;background:#06B6D4;color:#fff;padding:12px 24px;border-radius:12px;text-decoration:none;font-weight:600">Verify my email</a>
       <p style="margin:20px 0 0;color:#64748B;font-size:13px">If you did not create this account, you can ignore this email.</p>`;

  return sendEmail({
    to: { email: to },
    subject: ar ? 'فعّل حسابك في صياب' : 'Verify your SIAB account',
    html: shell(body, ar ? 'rtl' : 'ltr'),
    text: ar ? `فعّل حسابك: ${link}` : `Verify your SIAB account: ${link}`,
  });
}

export async function sendOrderNotification(
  to: string,
  params: { reference: string; title: string; body: string },
  locale: 'en' | 'ar' = 'en',
): Promise<SendResult> {
  const ar = locale === 'ar';
  const body = `<h1 style="font-size:20px;margin:0 0 12px">${params.title}</h1>
    <p style="margin:0 0 8px;color:#334155;line-height:1.6">${params.body}</p>
    <p style="margin:16px 0 0;color:#64748B;font-size:13px">${ar ? 'رقم الطلب' : 'Order'}: ${params.reference}</p>`;
  return sendEmail({
    to: { email: to },
    subject: params.title,
    html: shell(body, ar ? 'rtl' : 'ltr'),
  });
}

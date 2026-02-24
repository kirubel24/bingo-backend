let nodemailerModule = null;

let transporter;
export const getTransporter = async () => {
  if (transporter) return transporter;
  try {
    if (!nodemailerModule) {
      // Dynamically import nodemailer to avoid boot failure if missing
      nodemailerModule = (await import('nodemailer')).default;
    }

    const hasSmtpEnv = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
    if (hasSmtpEnv) {
      transporter = nodemailerModule.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });
    } else {
      // Development fallback: use Ethereal test SMTP so emails work without real SMTP
      const testAccount = await nodemailerModule.createTestAccount();
      transporter = nodemailerModule.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass,
        },
      });
      console.log('[Email] Using Ethereal test SMTP. Messages will have a preview URL.');
    }
  } catch (err) {
    throw new Error('Email transport not available: install nodemailer in backend (npm i nodemailer).');
  }
  return transporter;
};

export const sendEmail = async ({ to, subject, text, html }) => {
  const from = process.env.SMTP_FROM || 'no-reply@bingo.local';
  const t = await getTransporter();
  const info = await t.sendMail({ from, to, subject, text, html });
  // If using Ethereal, output the preview URL to help testing
  try {
    const getUrl = nodemailerModule.getTestMessageUrl;
    if (typeof getUrl === 'function') {
      const url = getUrl(info);
      if (url) console.log('[Email] Preview URL:', url);
    }
  } catch {}
  return info;
};
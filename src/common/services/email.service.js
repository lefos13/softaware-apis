/*
 * SMTP delivery is centralized so approval and rejection flows share one
 * transport configuration and return the same operational errors on failure.
 */
import nodemailer from 'nodemailer';
import { ApiError } from '../utils/api-error.js';
import { env } from '../../config/env.js';

let transporter = null;

/*
 * Email delivery supports both generic SMTP and Gmail so access approval flows
 * can use provider-specific auth while preserving one shared error contract.
 */
const getEmailProvider = () =>
  String(env.emailProvider || 'smtp')
    .trim()
    .toLowerCase();

const hasSmtpConfig = () =>
  Boolean(
    String(env.smtpHost || '').trim() &&
    Number.isInteger(env.smtpPort) &&
    env.smtpPort > 0 &&
    String(env.emailFrom || '').trim(),
  );

const hasGmailAppPasswordConfig = () =>
  Boolean(
    String(env.gmailUser || '').trim() &&
    String(env.gmailAppPassword || '').trim() &&
    String(env.emailFrom || '').trim(),
  );

const hasGmailOauth2Config = () =>
  Boolean(
    String(env.gmailUser || '').trim() &&
    String(env.gmailClientId || '').trim() &&
    String(env.gmailClientSecret || '').trim() &&
    String(env.gmailRefreshToken || '').trim() &&
    String(env.emailFrom || '').trim(),
  );

const hasMailConfig = () => {
  const provider = getEmailProvider();

  if (provider === 'gmail') {
    return hasGmailAppPasswordConfig() || hasGmailOauth2Config();
  }

  return hasSmtpConfig();
};

const buildTransportOptions = () => {
  const provider = getEmailProvider();
  if (provider === 'gmail') {
    const gmailUser = String(env.gmailUser || '').trim();
    const gmailAppPassword = String(env.gmailAppPassword || '').trim();

    if (gmailAppPassword) {
      return {
        service: 'gmail',
        auth: {
          user: gmailUser,
          pass: gmailAppPassword,
        },
      };
    }

    return {
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user: gmailUser,
        clientId: String(env.gmailClientId || '').trim(),
        clientSecret: String(env.gmailClientSecret || '').trim(),
        refreshToken: String(env.gmailRefreshToken || '').trim(),
        accessToken: String(env.gmailAccessToken || '').trim() || undefined,
      },
    };
  }

  const authUser = String(env.smtpUser || '').trim();
  const authPass = String(env.smtpPass || '');

  return {
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    auth: authUser || authPass ? { user: authUser, pass: authPass } : undefined,
  };
};

const getTransporter = () => {
  if (transporter) {
    return transporter;
  }

  transporter = nodemailer.createTransport(buildTransportOptions());
  return transporter;
};

export const assertEmailDeliveryConfigured = () => {
  if (hasMailConfig()) {
    return;
  }

  const provider = getEmailProvider();
  const issue =
    provider === 'gmail'
      ? 'Set EMAIL_PROVIDER=gmail, GMAIL_USER, EMAIL_FROM and either GMAIL_APP_PASSWORD or Gmail OAuth2 credentials'
      : 'Set SMTP_HOST, SMTP_PORT, and EMAIL_FROM before approving or rejecting requests';

  throw new ApiError(503, 'EMAIL_NOT_CONFIGURED', 'Email delivery is not configured', {
    details: [
      {
        field: provider === 'gmail' ? 'gmail' : 'smtp',
        issue,
      },
    ],
  });
};

export const sendEmail = async ({ to, subject, text, html }) => {
  assertEmailDeliveryConfigured();

  try {
    const info = await getTransporter().sendMail({
      from: env.emailFrom,
      replyTo: env.emailReplyTo || undefined,
      to,
      subject,
      text,
      html,
    });

    return {
      messageId: info?.messageId || null,
    };
  } catch (error) {
    throw new ApiError(502, 'EMAIL_DELIVERY_FAILED', 'Could not send email notification', {
      details: [
        {
          field: 'email',
          issue: error instanceof Error ? error.message : 'Unknown email delivery error',
        },
      ],
    });
  }
};

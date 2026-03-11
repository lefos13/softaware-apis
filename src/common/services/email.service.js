/*
 * SMTP delivery is centralized so approval and rejection flows share one
 * transport configuration and return the same operational errors on failure.
 */
import nodemailer from 'nodemailer';
import { ApiError } from '../utils/api-error.js';
import { env } from '../../config/env.js';

let transporter = null;

const hasMailConfig = () =>
  Boolean(
    String(env.smtpHost || '').trim() &&
    Number.isInteger(env.smtpPort) &&
    env.smtpPort > 0 &&
    String(env.emailFrom || '').trim(),
  );

const buildTransportOptions = () => {
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

  throw new ApiError(503, 'EMAIL_NOT_CONFIGURED', 'Email delivery is not configured', {
    details: [
      {
        field: 'smtp',
        issue: 'Set SMTP_HOST, SMTP_PORT, and EMAIL_FROM before approving or rejecting requests',
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

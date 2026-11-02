import nodemailer, { type Transporter } from "nodemailer";

import { env } from "../config/env.js";

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!env.smtp.host) {
    return null;
  }

  transporter ??= nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    // Port 465 uses implicit TLS; other ports upgrade with STARTTLS.
    secure: env.smtp.port === 465,
    auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined
  });

  return transporter;
}

export type Email = { to: string; subject: string; text: string; html: string };

/**
 * Sends an email over SMTP. Without SMTP settings it prints the message instead, so the reset flow can be tried
 * locally; in production a missing SMTP_HOST is an error because nobody would ever receive the link.
 */
export async function sendEmail(message: Email): Promise<void> {
  const smtp = getTransporter();

  if (!smtp) {
    if (env.isProduction) {
      throw new Error("SMTP_HOST is not configured.");
    }

    console.log(`[mail:dev] To: ${message.to}\nSubject: ${message.subject}\n${message.text}`);
    return;
  }

  await smtp.sendMail({ from: env.smtp.from, ...message });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

/** The password reset email: a single link that works once and expires. */
export function passwordResetEmail(to: string, displayName: string, link: string, minutes: number): Email {
  const name = escapeHtml(displayName);
  const url = escapeHtml(link);

  return {
    to,
    subject: "Reset your Toones password",
    text:
      `Hi ${displayName},\n\n` +
      `Someone asked to reset the password for your Toones account. Choose a new one here (the link works once and expires in ${minutes} minutes):\n\n` +
      `${link}\n\n` +
      `If this wasn't you, ignore this email. Your password stays the same.\n\n— Toones`,
    html:
      `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1f1f1f">` +
      `<h2 style="margin:0 0 12px">Reset your password</h2>` +
      `<p>Hi ${name},</p>` +
      `<p>Someone asked to reset the password for your Toones account. The link below works once and expires in ${minutes} minutes.</p>` +
      `<p style="margin:24px 0"><a href="${url}" style="background:#1f1f1f;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600">Choose a new password</a></p>` +
      `<p style="font-size:13px;color:#666">Or paste this into your browser:<br>${url}</p>` +
      `<p style="font-size:13px;color:#666">If this wasn't you, ignore this email. Your password stays the same.</p></div>`
  };
}

/** Heads-up sent after a reset, so the owner notices if someone else did it. */
export function passwordChangedEmail(to: string, displayName: string): Email {
  const name = escapeHtml(displayName);

  return {
    to,
    subject: "Your Toones password was changed",
    text:
      `Hi ${displayName},\n\nThe password for your Toones account was just changed. ` +
      `If that was you, there's nothing more to do. If not, reset it again right away from the sign-in page.\n\n— Toones`,
    html:
      `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1f1f1f">` +
      `<h2 style="margin:0 0 12px">Password changed</h2><p>Hi ${name},</p>` +
      `<p>The password for your Toones account was just changed. If that was you, there's nothing more to do.</p>` +
      `<p>If it wasn't, reset it again right away from the sign-in page.</p></div>`
  };
}
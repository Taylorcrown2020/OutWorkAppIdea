'use strict';
/* Email goes out through Brevo's transactional email API.
   Set BREVO_API_KEY, MAIL_FROM_EMAIL and MAIL_FROM_NAME. The sender address must be
   a verified sender in your Brevo account. With no key set (local development),
   emails are written to the server log instead of being sent. */
const APP_URL = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const KEY = process.env.BREVO_API_KEY || '';
const FROM = { name: process.env.MAIL_FROM_NAME || 'Outwork', email: process.env.MAIL_FROM_EMAIL || 'no-reply@example.com' };
const PROD = process.env.NODE_ENV === 'production';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function layout(title, lines, button) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:28px;color:#000">
  <div style="font-size:22px;font-weight:bold;color:#FF6A00">Outwork</div>
  <h1 style="font-size:22px;margin:22px 0 12px">${esc(title)}</h1>
  ${lines.map((l) => `<p style="font-size:16px;line-height:1.5;margin:0 0 12px">${l}</p>`).join('')}
  ${button ? `<p style="margin:22px 0"><a href="${esc(button.url)}" style="background:#FF6A00;color:#fff;text-decoration:none;font-weight:bold;padding:14px 22px;border-radius:6px;display:inline-block">${esc(button.label)}</a></p>` : ''}
  </div>`;
}

async function send(to, toName, subject, text, html) {
  if (!KEY) {
    // Development only. In production a missing key is an error, and message bodies are never logged.
    if (PROD) { console.error('BREVO_API_KEY is not set. Email not sent:', subject); return; }
    console.log(`[email not sent, no BREVO_API_KEY] to=${to} subject="${subject}"\n${text}\n`);
    return;
  }
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': KEY, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: FROM, to: [{ email: to, name: toName || undefined }], subject, htmlContent: html, textContent: text })
    });
    if (!res.ok) console.error('Brevo refused an email:', res.status, (await res.text()).slice(0, 300));
  } catch (e) {
    console.error('Email failed:', subject, e.message);   // a failed email never breaks the request
  }
}

module.exports = {
  invite(to, name, inviter, group, code) {
    const url = `${APP_URL}/signup.html?code=${encodeURIComponent(code)}`;
    return send(to, name, `${inviter} invited you to ${group} on Outwork`,
      `Hi ${name},\n\n${inviter} invited you to join "${group}", a workout challenge on Outwork.\n\n1. Create your account: ${url}\n2. Log in and enter the group code: ${code}\n\n${inviter} will admit you once you ask to join.`,
      layout(`${inviter} invited you to ${group}`, [
        `Hi ${esc(name)},`,
        `${esc(inviter)} invited you to join <b>${esc(group)}</b>, a workout challenge on Outwork.`,
        `Create your account, log in, then enter this group code:`,
        `<span style="font-size:28px;font-weight:bold;letter-spacing:4px;color:#FF6A00">${esc(code)}</span>`,
        `${esc(inviter)} will admit you once you ask to join.`
      ], { url, label: 'Create your account' }));
  },
  joinRequest(to, admin, person, group) {
    const url = `${APP_URL}/dashboard.html`;
    return send(to, admin, `${person} wants to join ${group}`,
      `Hi ${admin},\n\n${person} entered the code for "${group}" and is waiting for you to admit them.\n\nOpen your dashboard to admit or decline: ${url}`,
      layout(`${person} wants to join ${group}`, [`Hi ${esc(admin)},`, `<b>${esc(person)}</b> entered the code for <b>${esc(group)}</b> and is waiting for you to admit them.`],
        { url, label: 'Open your dashboard' }));
  },
  admitted(to, person, group) {
    const url = `${APP_URL}/dashboard.html`;
    return send(to, person, `You are in: ${group}`,
      `Hi ${person},\n\nYou have been admitted to "${group}". Log in to see the leaderboard and log your first workout: ${url}`,
      layout(`You are in: ${group}`, [`Hi ${esc(person)},`, `You have been admitted to <b>${esc(group)}</b>. Log in to see the leaderboard and log your first workout.`],
        { url, label: 'Go to the leaderboard' }));
  },
  declined(to, person, group) {
    return send(to, person, `Your request to join ${group}`,
      `Hi ${person},\n\nYour request to join "${group}" was not accepted. If you think this is a mistake, contact the person who invited you.`,
      layout(`Your request to join ${group}`, [`Hi ${esc(person)},`, `Your request to join <b>${esc(group)}</b> was not accepted. If you think this is a mistake, contact the person who invited you.`]));
  },
  reset(to, person, token, minutes) {
    // The token rides after the # so it is never sent to the server in an address or written to request logs.
    const url = `${APP_URL}/reset.html#token=${encodeURIComponent(token)}`;
    return send(to, person, 'Reset your Outwork password',
      `Hi ${person},\n\nSomeone asked to reset the password for your Outwork account. Choose a new one here:\n${url}\n\nThe link works once and expires in ${minutes} minutes. If this was not you, ignore this email and your password stays the same.`,
      layout('Reset your password', [`Hi ${esc(person)},`, `Someone asked to reset the password for your Outwork account.`,
        `The link works once and expires in ${minutes} minutes. If this was not you, ignore this email and your password stays the same.`],
        { url, label: 'Choose a new password' }));
  }
};

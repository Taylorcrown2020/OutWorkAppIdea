# Outwork

Group workout challenges with accounts, groups, a live leaderboard and power rankings.
Node and Express on the server, Postgres for the database, plain HTML, CSS and JavaScript in the browser.

## What is in here

| Path | What it is |
|---|---|
| `server/index.js` | Starts the server. Security headers, rate limits, HTTPS redirect, static files. |
| `server/routes.js` | The API: accounts, groups, invites, admissions, workouts, leaderboard, power rankings, live updates. |
| `server/forms.js` | Sign up, log in, forgot password, and every other form that takes a password. |
| `server/auth.js` | Password hashing, sessions, account lockout. |
| `server/scoring.js` | The points system. The only place points are calculated. |
| `server/mail.js` | The emails, sent through Brevo: invite, join request, admitted, declined, password reset. |
| `server/schema.sql` | The database tables. Applied automatically when the server starts. |
| `public/` | The website: marketing pages, `login.html`, `signup.html`, `forgot.html`, `reset.html`, `dashboard.html`. |
| `public/avatars/` | Account icons. Drop your images here (see below). |
| `test/api.test.js` | End to end test of the API. |

## Run it on your computer

1. Install Node 20 or newer and Postgres.
2. Create a database, then copy `.env.example` to `.env` and set `DATABASE_URL`.
3. `npm install`
4. `npm start`
5. Open http://localhost:3000

With no Brevo key, emails are printed to the server log instead of being sent, so you can test invites and password resets without a mail account.

To run the test: start the server, then `node test/api.test.js`.

## Put it online with Render

1. Push this folder to a GitHub repository.
2. In Render choose New, then Blueprint, and pick the repository. `render.yaml` creates the web service and the Postgres database and connects them.
3. Fill in `APP_URL` (your site address), `BREVO_API_KEY` and `MAIL_FROM_EMAIL`.
4. Deploy. The tables are created on first start.

Render terminates HTTPS for you. With `NODE_ENV=production` the server redirects plain HTTP to HTTPS, marks the session cookie Secure, and sends strict transport security headers.

## Email with Brevo

1. In Brevo, open SMTP and API, then API Keys, and create a key. Put it in `BREVO_API_KEY`.
2. In Brevo, add and verify the address you will send from (Senders, Domains and Dedicated IPs). Put it in `MAIL_FROM_EMAIL`. Brevo only sends from verified senders.
3. For good delivery, authenticate your domain in Brevo so the emails are signed as coming from you.

The server calls Brevo's transactional email API directly. If Brevo refuses an email, the reason is written to the server log and the person's action still completes.

## Passwords

No JavaScript in the browser ever reads, holds or sends a password. Sign up, log in, forgot password, reset, change password, change email and delete account are plain HTML forms that post straight to the server over HTTPS (`server/forms.js`). The server stores only a salted hash. The scripts on those pages only show messages.

## Your icons

Put your images in `public/avatars/` (png, jpg, webp or svg, square works best). Every file in that folder appears in the icon picker on the Profile tab. Delete the twelve placeholder icons when yours are in.

## Hero video

Open `public/outwork.js` and search for `PUT YOUR VIDEO HERE`. Put the video file in `public/` and set `HERO_VIDEO` to its file name.

## How it works for a person

1. Sign up creates the account and sends them to the log in page.
2. Log in opens the dashboard. With no group, the leaderboard is empty and there are two choices: create a group or enter a code.
3. Whoever creates a group is its admin. They set the length, the daily limit and the rates, and add people by name and email. Each person gets an email with a sign up link and the group code.
4. When someone enters the code, the admin gets an email and a notification, and admits or declines them on the Group tab. The person gets a confirmation email.
5. Everyone in the group sees the same leaderboard. It updates live when anyone logs a workout.
6. On their next visit, a pop up lists what changed since they last looked.
7. Leaving a group is one button on the Group tab. They come off the leaderboard and the ranks adjust.
8. The admin cannot leave or be removed while other people are in the group. An admin who is alone in a group can close it.
9. A person can be in several groups. The My groups tab shows each one with their place in it, and one tap switches between them.
10. A workout is logged once and counts in every group the person is in, scored at each group's own rates. A group only counts workouts dated on or after its challenge started, so nothing from before is carried in.
11. Forgot password emails a link that works once and expires after an hour.

## Scoring

All in `server/scoring.js`. Rates per category are in `CATS`. The pace bonus, PR bonus and streak values are the four constants under it.

## Not built yet

- Email verification at sign up
- Two step sign in
- Removing a member as admin
- Running more than one server instance. Live updates are held in memory, so a second instance would need a shared channel such as Redis.

See `SECURITY.md` for the security controls and what SOC 2 needs beyond the code.

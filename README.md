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
| `server/mail.js` | The emails, sent through Brevo: invite, someone joined (to the admin), you are in (to the person), challenge ended, password reset. |
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
2. Log in opens the dashboard. The first time, a pop up sends them to the Profile tab to enter their PRs. It shows once. With no group, the leaderboard is empty and there are two choices: create a group or enter a code.
3. Whoever creates a group is its admin. They set the length, the daily limit and the rates, and add people by name and email. Each person gets an email with a sign up link and the group code.
4. When someone enters the code, or signs up and logs in from the invite link, they are in the group right away. There is no admit step. The admin gets an email and a notification, and the person gets a confirmation email.
   The admin can send any invite again from the Group tab, one at a time or to everyone who has not joined yet. The same invite cannot be resent within a minute.
5. Everyone in the group sees the same leaderboard. It updates live when anyone logs a workout.
6. On their next visit, a pop up lists what changed since they last looked. Pop ups and confirmation messages open in the middle of the screen.
   On phones and tablets the tabs sit behind the menu button, the same as the rest of the site.
   The tabs follow the challenge that is open. A running challenge has Leaderboard, Power rankings, Activity and Group. A finished or shut down challenge only has its final results and moves under Past challenges on My groups, where anyone can take it off their own list.
   Someone in one running challenge lands on its leaderboard. Someone in several lands on My groups and picks one. Each challenge is its own card.
   A logged workout goes into every running challenge it fits, each scored at that challenge's rates. A workout can be logged for today, yesterday, or any earlier day of the challenge if it was forgotten. Time is entered as hours, minutes and seconds, and distance takes decimals, so both are stored exactly as typed.
   A challenge starts on the creator's own calendar day, not the server's.
7. Leaving a group is one button on the Group tab. They come off the leaderboard and the ranks adjust.
8. The admin cannot leave or be removed while other people are in the group. An admin who is alone in a group can delete it.
   The admin can shut the challenge down early from the Group tab. The leaderboard freezes, whoever is in first wins, nothing more can be logged or removed, and everyone in the group is emailed. It cannot be undone.
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

## Scoring

All of it lives in `server/scoring.js`. The public explanation is `public/scoring.html`, which is written by `public/outwork.js`.

1. The work. Distance times the challenge's rate. Strength reps are scaled by weight against the player's 1 rep max. Bodyweight reps count in full.
2. Effort bonus. Up to +50% of the work, by how close the workout is to the player's own best. Nothing at 50% of their best or below, climbing evenly to the full bonus at 100%.
   The best is measured per sport: fastest mile for running and walking, best average speed for riding, fastest 100 yards for swimming, fastest 500 meters for rowing, 1 rep max per exercise for strength, and most reps in one set for bodyweight moves.
   Each best is either tested or estimated, and a tested one always wins. A distance PR can be estimated from any other effort with Riegel's formula, time x (test distance / distance) ^ 1.06 (1.05 riding, 1.07 rowing): a 3:30 marathon works out to about a 6:35 mile. The riding test is average speed over 10 miles.
   A 1 rep max is worked out from any lift and its reps: weight x (1 + reps / 30), counting up to 12 reps. Each logged set is measured the same way.
3. Records. +10 for a new PR pace, a new 1 rep max, or the most bodyweight reps in a set. +10 for the longest distance logged in a sport, beaten by 5% or more. +5 for the most reps logged in a set of a lift. At most 30 record points a workout.
   The first workout in a sport or exercise sets the marks and earns none. PRs typed into the profile are not workouts: they set pace and 1 rep max only.
   Removing a workout works the longest distance and rep records out again from what is left.
4. Streak. +2 for each day in a row, up to +10 a day.

Workouts logged before this change keep the points they earned. Saved PRs carry over: a distance PR keeps its pace, and an old squat, bench or deadlift PR becomes that exercise's 1 rep max.

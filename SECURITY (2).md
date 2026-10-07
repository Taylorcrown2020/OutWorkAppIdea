# Security and SOC 2

## The honest position on SOC 2

Code cannot be SOC 2 compliant on its own. SOC 2 is an audit of a company: an independent CPA firm checks that the company has security controls and, for a Type 2 report, that it followed them over several months. What code and hosting can do is put the technical controls in place so the audit has something to pass.

So there are three layers:

1. **This application.** Built with the controls listed below.
2. **The hosting.** Render states that its platform is SOC 2 Type 2 and ISO 27001 compliant, and that it works on a shared responsibility model: they cover the platform, you cover your application and your own compliance. Their SOC 3 report is available to every workspace. The SOC 2 Type 2 report needs a paid workspace tier and a signed NDA. Check their compliance page for the current terms. Brevo, which sends the email, handles names and email addresses too, so do the same check on Brevo and keep their report or security documentation with your vendor records.
3. **Your company.** Policies, access reviews, vendor reviews, incident response, staff training, and the audit itself. Tools such as Vanta, Drata or Secureframe exist to run this part and connect you with an auditor.

Until an auditor issues your report, do not tell customers the product is SOC 2 compliant. You can say it is hosted on SOC 2 Type 2 infrastructure and describe the controls.

## Controls in this application

| Area | What is in place | Where |
|---|---|---|
| Passwords | Stored only as salted scrypt hashes. Minimum 10 characters. Never read or sent by browser JavaScript: every password form is a plain HTML form posted to the server. | `server/forms.js`, `server/auth.js` |
| Forgot password | Emailed link with a random 256 bit token. Only its hash is stored. Works once, expires in one hour, and signs out every device when used. The reply is the same whether or not the email has an account. The token travels after the # so it is not written to request logs. | `server/forms.js` |
| Sessions | Random 256 bit token in an HttpOnly, SameSite, Secure cookie. Only a hash of the token is stored. Ends after 14 days without use. Changing or resetting a password signs out other devices. | `server/auth.js` |
| Sign in abuse | 20 account form submissions per 15 minutes per address. Account locks for 15 minutes after 8 wrong passwords. The same error for a wrong email and a wrong password. | `server/index.js`, `server/auth.js` |
| Encryption in transit | HTTPS enforced in production, strict transport security, TLS to the database. | `server/index.js`, `server/db.js` |
| Encryption at rest | Provided by the database host. Confirm it is enabled on your plan. | Hosting |
| Access control | Every request is checked on the server. People only see groups they have joined with the group code. Only the admin can invite, resend invites or shut a challenge down. People can only delete their own workouts. | `server/routes.js` |
| Cross site attacks | Strict content security policy (scripts only from this site), no inline scripts, forms and API writes must come from this site's own pages, all output escaped. | `server/index.js`, `public/*.js` |
| Database safety | Every query uses parameters. No query is built from user text. | `server/*.js` |
| Input checks | Lengths, formats and ranges checked on the server for every field. Request bodies capped at 50 KB. | `server/routes.js`, `server/scoring.js` |
| Audit trail | Sign ins, failed sign ins, lockouts, password and profile changes, group creation, admissions, departures and account deletions are recorded with time, address and browser. | `audit_log` table |
| Logging | Request logs hold method, path, status and timing. Never passwords, cookies or request bodies. Email text is only printed in development. | `server/index.js` |
| Data kept | Name, email, password hash, chosen icon, PRs and workouts. Nothing else. | `server/schema.sql` |
| Deletion | People can delete their account. Their workouts, PRs, memberships and sessions are removed with it. | `DELETE /api/me` |
| Secrets | Database and email credentials come from environment variables. Nothing secret is in the code. | `.env.example` |

## What an auditor will also ask for

- Email verification at sign up (not built yet)
- Two step sign in, at least for your own admin access to hosting, database and email
- Database backups and a tested restore (turn on point in time recovery with your host)
- Error monitoring and alerts, and someone who receives them
- A retention period for the audit log and a routine for reviewing it
- Dependency updates: run `npm audit` regularly and turn on automated update alerts in GitHub
- A privacy policy and terms on the site that match what the product does with personal information
- A penetration test before the audit

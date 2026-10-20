# Chatgram Support — Knowledge Base

Single source of truth for the support assistant and the FAQ fallback.
The machine-readable copy lives at `server/src/support/knowledge-base.json`.

**Rules for the assistant:** use only this content; never ask for a password,
code or token; never claim to be human; if the answer is not here, offer to send
the report to Chatgram Support; reply in the user's language.

---

## register
**Titles:** How to register · Creating an account
**Keywords:** register, sign up, signup, create account, new account, fungura konti, créer un compte, fungua akaunti
**Answer:**
Open https://chatgram-xi.vercel.app/web/ and choose **Create account**. Enter your
full name, an **email address**, a password, and confirm the password. Tick the
Terms and Privacy box, then press **Send code**. We email a 6-digit code — enter
it to finish. You are signed in straight away.

Phone sign-up is **not available yet** — please use an email address. Phone
*login* works if your account already has a phone number.

---

## phone-format
**Titles:** Phone number format
**Keywords:** phone, number, country code, +250, format, telephone
**Answer:**
Phone numbers use the international E.164 format: a `+`, the country code, then
the number with no spaces — for example **+250788123456** for Rwanda. In the
sign-in screen a country picker appears automatically when you type a number, and
local numbers starting with `0` are converted for you (`0788123456` → `+250788123456`).

---

## password-rules
**Titles:** Password rules
**Keywords:** password, strong, length, characters, ijambo ry'ibanga, mot de passe, neno la siri
**Answer:**
Passwords must be **at least 8 characters**. A mix of upper and lower case,
numbers and symbols makes an account much harder to break into. The sign-up form
shows a strength meter. We never ask for your password by email or chat — anyone
who does is not us.

---

## forgot-password
**Titles:** Forgot or reset password
**Keywords:** forgot, reset, reset password, can't sign in, locked out, change password, wibagiwe, oublié, umesahau
**Answer:**
On the sign-in screen choose **Forgot password?**, enter the email or phone on
your account and press **Send code**. We email a 6-digit code that expires
quickly. Enter the code with a new password, then sign in again. If the code
does not arrive, check spam and try again after a minute.

---

## no-code
**Titles:** I did not receive the code
**Keywords:** no code, didn't get code, not received, email not arrived, spam, verification code, kode, msimbo
**Answer:**
Check these in order:
1. The **spam / junk** folder.
2. That you typed the address correctly (no typos, no spaces).
3. Wait up to 5 minutes — delivery can be slow.
4. Press **Resend** once, not repeatedly: repeated requests are rate limited.
5. Try a different email provider if it keeps failing.

If nothing arrives after 10 minutes, send a report to Chatgram Support from this
panel and we will verify your address manually.

---

## account-locked
**Titles:** Account locked after too many attempts
**Keywords:** locked, too many attempts, blocked, retry after, rate limit, blocked account
**Answer:**
After several failed sign-ins the account is temporarily locked to protect it.
The message tells you how many seconds to wait — usually a few minutes. Wait, then
try once with the correct password. If you are unsure of the password, use
**Forgot password?** instead of guessing again.

---

## install-windows
**Titles:** Install on Windows
**Keywords:** windows, install, desktop, pc, setup, exe, download windows
**Answer:**
Download the installer from https://chatgram.duckdns.org/downloads/chatgram-windows-setup.exe
and run it. Because the installer is not code-signed yet, Windows SmartScreen may
warn — choose **More info → Run anyway**. The desktop app uses the same account as
the web app.

---

## install-android
**Titles:** Install on Android
**Keywords:** android, apk, phone install, mobile, download android
**Answer:**
Download the APK from https://chatgram.duckdns.org/downloads/chatgram.apk. Android
will ask you to allow installation from your browser — enable it, then install.
The APK is not on the Play Store yet, so updates are manual for now.

---

## notifications
**Titles:** Notifications are not working
**Keywords:** notification, no notification, sound, alert, popup, email notification
**Answer:**
On the web app, open **Settings → Notifications** and enable **Desktop
notifications**; your browser will ask for permission — allow it. Notifications
only appear when the Chatgram window is not focused. Message sounds have a
separate toggle. On Android, enable notifications for Chatgram in the system
settings.

---

## contact-support
**Titles:** How to contact support
**Keywords:** support, contact, human, agent, help, report, ticket
**Answer:**
Use this help panel and choose **Send report to support**. Include the email or
phone on your account so we can reply, and optionally attach technical details
(browser and page) which makes problems much faster to diagnose. You get a ticket
ID such as **CG-7F3K9** — keep it to check the status or quote it in a follow-up.
Support replies by email, and you can watch the ticket in this panel.

---

## ticket-status
**Titles:** Check a ticket status
**Keywords:** ticket, status, ticket id, my report, follow up
**Answer:**
Choose **Check ticket status** in this panel, enter the ticket ID (for example
CG-7F3K9) and the same email or phone you used when reporting. We only show the
ticket to the matching contact, so a wrong contact returns "not found".

---

## security
**Titles:** Account security
**Keywords:** hacked, suspicious, security, stolen, compromise, password leaked
**Answer:**
If you think someone else has access to your account: change your password
immediately with **Forgot password?**, then send a report to support from this
panel so we can review recent activity. Never share your password or verification
codes — Chatgram staff will never ask for them.

---

## encryption
**Titles:** Is Chatgram encrypted?
**Keywords:** encryption, privacy, secure, end-to-end, e2ee, read messages
**Answer:**
Connections are encrypted in transit with TLS. Messages are **not end-to-end
encrypted yet**, which means our servers can technically read them. End-to-end
encryption is on the roadmap and is listed publicly in our Privacy Policy at
https://chatgram-xi.vercel.app/docs#privacy.

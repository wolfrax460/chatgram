import { useEffect } from 'react';

/**
 * Terms of Service + Privacy Policy, served at /docs.
 * The auth screens deep-link to /docs#terms and /docs#privacy.
 */
export default function Docs() {
  useEffect(() => {
    // Honour the hash on first load so /docs#privacy lands on the right section.
    if (window.location.hash) {
      const el = document.querySelector(window.location.hash);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    document.title = 'Chatgram — Terms & Privacy';
  }, []);

  return (
    <div className="docs-page">
      <header className="docs-head">
        <div className="wrap">
          <a href="/" className="docs-back">← Back to Chatgram</a>
          <h1>Legal &amp; Documentation</h1>
          <p className="docs-updated">Last updated: 20 October 2026</p>
          <nav className="docs-toc">
            <a href="#terms">Terms of Service</a>
            <a href="#privacy">Privacy Policy</a>
          </nav>
        </div>
      </header>

      <main className="wrap docs-body">
        <section id="terms">
          <h2>Terms of Service</h2>

          <h3>1. Acceptance</h3>
          <p>
            By creating an account or using Chatgram you agree to these Terms. If you do not
            agree, do not use the service. You must be at least 16 years old, or have the
            consent of a parent or guardian.
          </p>

          <h3>2. Your account</h3>
          <p>
            You are responsible for keeping your password safe and for everything that happens
            under your account. Use accurate information. Do not share your account. Tell us
            immediately if you believe it has been compromised.
          </p>

          <h3>3. Acceptable use</h3>
          <p>You must not use Chatgram to:</p>
          <ul>
            <li>send spam, malware, or illegal content;</li>
            <li>harass, threaten, or impersonate anyone;</li>
            <li>break any applicable law;</li>
            <li>attempt to access accounts, servers, or data that are not yours;</li>
            <li>scrape, reverse engineer, or overload the service.</li>
          </ul>

          <h3>4. Your content</h3>
          <p>
            You keep ownership of the messages, photos, voice notes and statuses you send. You
            grant us the limited licence needed to store and deliver that content to the people
            you are communicating with. We do not sell your content.
          </p>

          <h3>5. Availability</h3>
          <p>
            Chatgram is provided &ldquo;as is&rdquo;. We aim for high availability but do not
            guarantee uninterrupted service. Features may change, and some are still in
            development.
          </p>

          <h3>6. Termination</h3>
          <p>
            You may stop using Chatgram at any time. We may suspend or remove accounts that
            break these Terms or that we reasonably believe put other users at risk.
          </p>

          <h3>7. Limitation of liability</h3>
          <p>
            To the extent permitted by law, we are not liable for indirect or consequential
            losses, or for loss of data caused by events outside our reasonable control.
          </p>

          <h3>8. Changes</h3>
          <p>
            We may update these Terms. If a change is material we will notify you in the app
            before it takes effect. Continued use after that means you accept the new Terms.
          </p>

          <h3>9. Contact</h3>
          <p>
            Questions about these Terms: <a href="mailto:support@chatgram.local">support@chatgram.local</a>,
            or use <strong>Help &amp; feedback</strong> inside the app.
          </p>
        </section>

        <section id="privacy">
          <h2>Privacy Policy</h2>

          <h3>1. What we collect</h3>
          <ul>
            <li><strong>Account data</strong> — your name, email address or phone number, and a hashed password.</li>
            <li><strong>Content</strong> — messages, attachments and status updates you send.</li>
            <li><strong>Technical data</strong> — IP address, device type, app version, and connection timestamps, used for security and debugging.</li>
            <li><strong>Presence</strong> — whether you are online and when you were last seen, if you leave that enabled.</li>
          </ul>

          <h3>2. How we use it</h3>
          <p>
            To deliver your messages, keep your account secure, provide support, and understand
            which features are used so we can improve them. We do not sell your personal data or
            use it for advertising.
          </p>

          <h3>3. What we do not do</h3>
          <ul>
            <li>We do not sell your data.</li>
            <li>We do not read your conversations except where you report a problem and share it with support.</li>
            <li>We do not use your content to train advertising models.</li>
          </ul>

          <h3>4. Who can see your information</h3>
          <p>
            Your profile name and avatar are visible to people you chat with. Your phone number
            and email are not shown publicly. Status updates are visible to your contacts only and
            disappear after 24 hours.
          </p>

          <h3>5. Where your data is stored</h3>
          <p>
            Data is stored on our servers hosted in the cloud, with media files stored on a
            third-party media CDN (Cloudinary). Connections are encrypted in transit with TLS.
          </p>

          <h3>6. Your rights</h3>
          <p>
            You can update your name, photo and about text in Settings at any time, and you can
            delete your account by contacting support. You may request a copy of your data.
          </p>

          <h3>7. Retention</h3>
          <p>
            Messages are kept until you delete them or your account is removed. Status updates
            are deleted automatically after 24 hours. Deleted-for-everyone messages are cleared
            from our database.
          </p>

          <h3>8. Security</h3>
          <p>
            Passwords are hashed with bcrypt and never stored or logged in plain text. Access
            tokens are short-lived. Please note: <strong>messages are not end-to-end encrypted</strong> —
            they are encrypted in transit, but our servers can technically read them. End-to-end
            encryption is on the roadmap. Authorised Chatgram administrators can review conversation content (messages, media and account data) for security, abuse and legal reasons. Every review requires a written reason, is read-only, and is recorded in an append-only audit log kept for two years.
          </p>

          <h3>9. Children</h3>
          <p>Chatgram is not intended for anyone under 16.</p>

          <h3>10. Changes</h3>
          <p>
            If this policy changes materially we will tell you in the app before the change takes
            effect.
          </p>

          <h3>11. Contact</h3>
          <p>
            Privacy questions: <a href="mailto:support@chatgram.local">support@chatgram.local</a>.
          </p>
        </section>
      </main>

      <footer className="docs-foot">
        <div className="wrap">
          <a href="/">Chatgram</a> · <a href="/docs#terms">Terms</a> ·{' '}
          <a href="/docs#privacy">Privacy</a> · <a href="/web/">Open the app</a>
        </div>
      </footer>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useTheme } from './theme.js';
import PhoneDemo from './PhoneDemo.jsx';
import { Reveal } from './reveal.jsx';
import {
  Icon,
  Section,
  Facts,
  Features,
  Screenshots,
  Security,
  Download,
  Steps,
  Changelog,
  Roadmap,
  Faq,
  DOWNLOADS,
} from './sections.jsx';

/* Fallback sizes — replaced by the real Content-Length when reachable. */
const FALLBACK_SIZES = { android: '55.3', windows: '12.3' };

function useDownloadSizes() {
  const [sizes, setSizes] = useState(FALLBACK_SIZES);

  useEffect(() => {
    let cancelled = false;
    async function probe(url, key) {
      try {
        const res = await fetch(url, { method: 'HEAD' });
        const len = res.headers.get('content-length');
        if (!len || cancelled) return;
        const mb = (parseInt(len, 10) / 1048576).toFixed(1);
        setSizes((prev) => ({ ...prev, [key]: mb }));
      } catch {
        /* offline or CORS blocked — keep the fallback */
      }
    }
    probe(DOWNLOADS.android, 'android');
    probe(DOWNLOADS.windows, 'windows');
    return () => {
      cancelled = true;
    };
  }, []);

  return sizes;
}

/* ------------------------------------------------------------------- brand */
function Brand() {
  return (
    <a className="brand-link" href="/" aria-label="Chatgram home">
      <svg className="logo" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M12 2C6.48 2 2 5.94 2 10.8c0 2.7 1.39 5.11 3.58 6.72L4.6 22l4.9-2.6c.81.17 1.65.26 2.5.26 5.52 0 10-3.94 10-8.8S17.52 2 12 2Z"
          fill="var(--brand)"
        />
        <path d="M7.6 9.3h8.8M7.6 12.4h5.6" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <span>Chatgram</span>
    </a>
  );
}

/* -------------------------------------------------------------- theme swtch */
function ThemeSwitch({ mode, setMode }) {
  const options = [
    { key: 'light', label: 'Light', icon: Icon.sun },
    { key: 'dark', label: 'Dark', icon: Icon.moon },
    { key: 'system', label: 'System', icon: Icon.monitor },
  ];

  return (
    <div className="theme-switch" role="group" aria-label="Colour theme">
      {options.map(({ key, label, icon }) => (
        <button
          key={key}
          type="button"
          className={mode === key ? 'theme-opt active' : 'theme-opt'}
          onClick={() => setMode(key)}
          title={`${label} theme`}
          aria-pressed={mode === key}
        >
          {icon}
          <span className="sr-only">{label}</span>
        </button>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------------- nav */
function Nav({ mode, setMode }) {
  const [open, setOpen] = useState(false);

  const links = [
    ['#features', 'Features'],
    ['#preview', 'Preview'],
    ['#security', 'Privacy'],
    ['#download', 'Download'],
    ['#whats-new', "What's new"],
    ['#faq', 'FAQ'],
  ];

  return (
    <header className="site-header">
      <div className="wrap nav">
        <Brand />
        <nav className={open ? 'nav-links open' : 'nav-links'}>
          {links.map(([href, label]) => (
            <a key={href} href={href} onClick={() => setOpen(false)}>
              {label}
            </a>
          ))}
        </nav>
        <div className="nav-spacer" />
        <ThemeSwitch mode={mode} setMode={setMode} />
        <a className="btn btn-primary nav-cta" href="/web/">
          Open Chatgram
        </a>
        <button
          type="button"
          className="nav-toggle"
          aria-label="Toggle menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>
      </div>
    </header>
  );
}

/* -------------------------------------------------------------------- hero */
function Hero({ sizes }) {
  return (
    <section className="hero">
      <div className="wrap hero-inner">
        <div className="hero-copy">
          <span className="hero-badge">
            <span className="dot" /> Free · No adverts · One account everywhere
          </span>
          <h1>
            Simple, reliable
            <br />
            messaging for
            <br />
            <em>everyone</em>.
          </h1>
          <p className="lead">
            Chatgram keeps you close to the people who matter — real-time chat, voice notes,
            photos, groups, 24-hour status and voice or video calls with up to 20 people, with
            two-step verification and privacy you actually control. On Android, Windows or right
            in your browser.
          </p>
          <div className="hero-actions">
            <a className="btn btn-primary btn-lg" href="/web/">
              Open in browser
            </a>
            <a className="btn btn-light btn-lg" href="#download">
              Download the app
            </a>
          </div>
          <div className="hero-platforms">
            <span>{Icon.android} Android {sizes.android} MB</span>
            <span>{Icon.windows} Windows {sizes.windows} MB</span>
            <span>{Icon.globe} Web — instant</span>
          </div>
        </div>
        <div className="hero-art">
          <PhoneDemo />
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ footer */
function Footer() {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="foot-grid">
          <div>
            <Brand />
            <p className="foot-tag">
              Simple, reliable messaging on every device you use.
            </p>
          </div>
          <div>
            <h4>Product</h4>
            <a href="#features">Features</a>
            <a href="#preview">Preview</a>
            <a href="#download">Download</a>
            <a href="/web/">Open web app</a>
          </div>
          <div>
            <h4>Help</h4>
            <a href="#how">Getting started</a>
            <a href="#faq">FAQ</a>
            <a href="#security">Privacy</a>
            <a href="#roadmap">Roadmap</a>
          </div>
        </div>
        <div className="foot-bottom">
          <span>© {new Date().getFullYear()} Chatgram. All rights reserved.</span>
          <span>Built with React · Node.js · MongoDB</span>
        </div>
      </div>
    </footer>
  );
}

/* --------------------------------------------------------------------- app */
export default function App() {
  const { mode, setMode } = useTheme();
  const sizes = useDownloadSizes();

  return (
    <>
      <Nav mode={mode} setMode={setMode} />
      <main>
        <Hero sizes={sizes} />

        <div className="wrap">
          <Facts />
        </div>

        <Section
          id="features"
          eyebrow="Features"
          title="Everything you need to stay in touch"
          lead="Every item below is live in the app today — not a someday list."
        >
          <Features />
        </Section>

        <Section
          id="preview"
          alt
          eyebrow="Preview"
          title="Take a look inside"
          lead="The same app on every platform, designed to feel familiar from the first tap."
        >
          <Screenshots />
        </Section>

        <Section
          id="security"
          eyebrow="Privacy"
          title="Your conversations stay yours"
          lead="Practical privacy you can actually see and control — not marketing language."
        >
          <Security />
        </Section>

        <Section
          id="download"
          alt
          eyebrow="Download"
          title="Pick your platform"
          lead="One account works across all three. Start on your phone, continue on your PC."
        >
          <Download sizes={sizes} />
        </Section>

        <Section
          id="how"
          eyebrow="Getting started"
          title="Up and running in three steps"
          lead="From first launch to your first message in under a minute."
        >
          <Steps />
        </Section>

        <Section
          id="whats-new"
          alt
          eyebrow="What's new"
          title="Release notes"
          lead="Everything that shipped in the current version."
        >
          <Changelog />
        </Section>

        <Section
          id="roadmap"
          eyebrow="Roadmap"
          title="What is coming next"
          lead="An honest look at what is in the works — no dates promised until they are ready."
        >
          <Roadmap />
        </Section>

        <Section
          id="faq"
          alt
          eyebrow="FAQ"
          title="Common questions"
          lead="If your question is not answered here, ask in the app and we will add it."
        >
          <Faq />
        </Section>
      </main>
      <Footer />
    </>
  );
}

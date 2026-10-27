/**
 * Small progressive-enhancement script for the static landing site.
 *
 * Content is already in the HTML. This file only adds:
 *   - the light/dark/system theme switch (same localStorage key as before)
 *   - the mobile navigation toggle
 *   - a progressive refresh of download version/date/links and release notes from
 *     the published release feed (GET /api/app/releases)
 *
 * File sizes and SHA-256 values are deliberately NOT overwritten by the feed:
 * they stay at the values verified against the files currently served from
 * /downloads/.
 */
(function () {
  'use strict';

  var root = document.documentElement;
  var STORAGE = 'chatgram-theme';
  var MODES = ['light', 'dark', 'system'];
  var mq = window.matchMedia('(prefers-color-scheme: dark)');

  function resolve(mode) {
    return mode === 'system' ? (mq.matches ? 'dark' : 'light') : mode;
  }

  function storedMode() {
    try {
      var value = localStorage.getItem(STORAGE);
      return MODES.indexOf(value) !== -1 ? value : 'system';
    } catch (error) {
      return 'system';
    }
  }

  var current = storedMode();

  function paintButtons(mode) {
    var buttons = document.querySelectorAll('[data-theme-mode]');
    for (var i = 0; i < buttons.length; i += 1) {
      buttons[i].setAttribute('aria-pressed', String(buttons[i].getAttribute('data-theme-mode') === mode));
    }
  }

  function apply(mode) {
    root.dataset.theme = resolve(mode);
    paintButtons(mode);
  }

  apply(current);

  var themeButtons = document.querySelectorAll('[data-theme-mode]');
  for (var t = 0; t < themeButtons.length; t += 1) {
    themeButtons[t].addEventListener('click', function (event) {
      current = event.currentTarget.getAttribute('data-theme-mode');
      apply(current);
      try {
        localStorage.setItem(STORAGE, current);
      } catch (error) {
        /* storage blocked — the theme still applies for this visit */
      }
    });
  }

  if (mq.addEventListener) {
    mq.addEventListener('change', function () {
      if (current === 'system') apply('system');
    });
  }

  /* ------------------------------------------------------------- mobile nav */
  var navToggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('site-nav');
  if (navToggle && nav) {
    navToggle.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', String(open));
    });
    var navLinks = nav.querySelectorAll('a');
    for (var n = 0; n < navLinks.length; n += 1) {
      navLinks[n].addEventListener('click', function () {
        nav.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
      });
    }
  }

  /* ------------------------------------------------------- release feed data */
  var cards = document.querySelectorAll('.dl-card[data-platform]');
  if (!cards.length) return;

  var cachedNotice = document.querySelector('[data-cached-notice]');
  var notesRoot = document.querySelector('[data-release-notes]');
  var whatsNew = document.querySelector('[data-whats-new]');
  var lang = root.lang === 'rw' ? 'rw-RW' : root.lang === 'fr' ? 'fr-FR' : root.lang === 'sw' ? 'sw-KE' : 'en-GB';
  var checkIcon =
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7"/></svg>';

  function formatDate(iso) {
    if (!iso) return '';
    var date = new Date(iso);
    if (isNaN(date.getTime())) return '';
    try {
      return date.toLocaleDateString(lang, { day: 'numeric', month: 'long', year: 'numeric' });
    } catch (error) {
      return date.toISOString().slice(0, 10);
    }
  }

  function notesItems(text) {
    return String(text || '')
      .split(/\r?\n/)
      .map(function (line) {
        return line.trim();
      })
      .filter(Boolean);
  }

  function hydrateReleaseNotes(releases) {
    if (!notesRoot || !whatsNew) return;
    notesRoot.textContent = '';
    releases
      .slice()
      .sort(function (a, b) {
        return new Date(b.releasedAt || 0) - new Date(a.releasedAt || 0);
      })
      .forEach(function (release) {
        var card = document.createElement('div');
        card.className = 'release';

        var head = document.createElement('div');
        head.className = 'release-head';
        var tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = 'v' + (release.version || '—');
        var date = document.createElement('span');
        date.className = 'release-date';
        var platformLabel = whatsNew.getAttribute('data-platform-' + release.platform) || release.platform;
        date.textContent = platformLabel + ' · ' + (formatDate(release.releasedAt) || '');
        head.appendChild(tag);
        head.appendChild(date);

        var list = document.createElement('ul');
        notesItems(release.releaseNotes).forEach(function (item) {
          var li = document.createElement('li');
          var tick = document.createElement('span');
          tick.className = 'tick';
          tick.innerHTML = checkIcon;
          li.appendChild(tick);
          li.appendChild(document.createTextNode(item));
          list.appendChild(li);
        });

        card.appendChild(head);
        card.appendChild(list);
        notesRoot.appendChild(card);
      });
  }

  function hydrate(payload) {
    var releases = payload && Array.isArray(payload.releases) ? payload.releases : null;
    if (!releases || !releases.length) return;
    releases.forEach(function (release) {
      var card = document.querySelector('.dl-card[data-platform="' + release.platform + '"]');
      if (!card) return;

      var versionEl = card.querySelector('[data-release-version]');
      if (versionEl && release.version) {
        versionEl.textContent = versionEl.getAttribute('data-version-prefix') + ' ' + release.version;
      }
      var versionTag = card.querySelector('.dl-version');
      if (versionTag && release.version) versionTag.textContent = 'v' + release.version;
      var chip = document.querySelector('[data-release-chip][data-platform="' + release.platform + '"] strong');
      if (chip && release.version) chip.textContent = 'v' + release.version;
      var dateEl = card.querySelector('[data-release-date]');
      if (dateEl) {
        var dateText = formatDate(release.releasedAt);
        if (dateText) dateEl.textContent = dateText;
      }
      var link = card.querySelector('[data-release-link]');
      if (link && release.fileUrl) link.setAttribute('href', release.fileUrl);
    });
    hydrateReleaseNotes(releases);
  }

  fetch('/api/app/releases', { headers: { Accept: 'application/json' } })
    .then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    })
    .then(hydrate)
    .catch(function () {
      if (cachedNotice) cachedNotice.hidden = false;
    });
})();

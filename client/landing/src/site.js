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

  /* --------------------------------------------------- install guide dialogs */
  /* The download buttons are real links to the real files; this only opens the
     install guide when the browser supports <dialog>. No storage, no cookies. */
  var guideDialogs = document.querySelectorAll('dialog[data-install-guide]');
  var guideOpeners = document.querySelectorAll('[data-install-guide-open]');
  var lastOpener = null;

  function openGuide(platform, opener) {
    var dialog = document.getElementById('install-guide-' + platform);
    if (!dialog || typeof dialog.showModal !== 'function') return false;
    lastOpener = opener || null;
    try {
      dialog.showModal();
    } catch (error) {
      return false;
    }
    root.classList.add('guide-open');
    var closeButton = dialog.querySelector('[data-install-guide-close]');
    if (closeButton) closeButton.focus();
    return true;
  }

  for (var o = 0; o < guideOpeners.length; o += 1) {
    guideOpeners[o].addEventListener('click', function (event) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      var platform = event.currentTarget.getAttribute('data-install-guide-open');
      if (openGuide(platform, event.currentTarget)) event.preventDefault();
    });
  }

  function wireGuideDialog(dialog) {
    var closeButton = dialog.querySelector('[data-install-guide-close]');
    if (closeButton) {
      closeButton.addEventListener('click', function () {
        dialog.close();
      });
    }
    /* Clicking the backdrop (the dialog element itself) closes it. */
    dialog.addEventListener('click', function (event) {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener('close', function () {
      root.classList.remove('guide-open');
      if (lastOpener && typeof lastOpener.focus === 'function') lastOpener.focus();
    });
    /* A native dialog handles Escape itself; this keeps the fallback tidy. */
    dialog.addEventListener('cancel', function () {
      root.classList.remove('guide-open');
    });
  }

  for (var gd = 0; gd < guideDialogs.length; gd += 1) wireGuideDialog(guideDialogs[gd]);

  /* ------------------------------------------------------ hero phone demo */
  /* The screens are real screenshots. This only swaps the active class and
     aria-hidden every 3.5 s (CSS does the fading/sliding), pauses on hover,
     pointer-down and keyboard focus, and respects prefers-reduced-motion. */
  var phoneDemo = document.querySelector('[data-phone-demo]');
  if (phoneDemo) {
    var phoneScreens = phoneDemo.querySelectorAll('[data-phone-screen]');
    var phoneDots = phoneDemo.querySelectorAll('[data-phone-dot]');
    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    var phoneIndex = 0;
    var phoneTimer = null;
    var phonePaused = false;

    function showPhoneScreen(index) {
      if (!phoneScreens.length) return;
      phoneIndex = ((index % phoneScreens.length) + phoneScreens.length) % phoneScreens.length;
      for (var s = 0; s < phoneScreens.length; s += 1) {
        var active = s === phoneIndex;
        phoneScreens[s].classList.toggle('is-active', active);
        phoneScreens[s].setAttribute('aria-hidden', active ? 'false' : 'true');
      }
      for (var d = 0; d < phoneDots.length; d += 1) {
        var dotActive = d === phoneIndex;
        phoneDots[d].classList.toggle('is-active', dotActive);
        if (dotActive) phoneDots[d].setAttribute('aria-current', 'true');
        else phoneDots[d].removeAttribute('aria-current');
      }
    }

    function stopPhoneTimer() {
      if (phoneTimer !== null) {
        window.clearInterval(phoneTimer);
        phoneTimer = null;
      }
    }

    function startPhoneTimer() {
      stopPhoneTimer();
      if (reduceMotion.matches || phoneScreens.length < 2) return;
      phoneTimer = window.setInterval(function () {
        if (!phonePaused) showPhoneScreen(phoneIndex + 1);
      }, 3500);
    }

    function pausePhone() {
      phonePaused = true;
    }

    function resumePhone() {
      phonePaused = false;
    }

    phoneDemo.addEventListener('mouseenter', pausePhone);
    phoneDemo.addEventListener('mouseleave', resumePhone);
    phoneDemo.addEventListener('pointerdown', pausePhone);
    phoneDemo.addEventListener('pointerup', resumePhone);
    phoneDemo.addEventListener('pointercancel', resumePhone);
    phoneDemo.addEventListener('focusin', pausePhone);
    phoneDemo.addEventListener('focusout', resumePhone);

    for (var pd = 0; pd < phoneDots.length; pd += 1) {
      phoneDots[pd].addEventListener('click', function (event) {
        var target = event.currentTarget.getAttribute('data-phone-dot');
        showPhoneScreen(Number(target));
      });
    }

    if (reduceMotion.addEventListener) {
      reduceMotion.addEventListener('change', function () {
        if (reduceMotion.matches) {
          stopPhoneTimer();
          showPhoneScreen(0);
        } else {
          startPhoneTimer();
        }
      });
    }

    showPhoneScreen(0);
    startPhoneTimer();
  }

  /* ---------------------------------------------------- sticky download bar */
  var quickBar = document.querySelector('[data-quick-bar]');
  if (quickBar) {
    var barVisible = false;
    var updateQuickBar = function () {
      var y = window.scrollY || document.documentElement.scrollTop || 0;
      var shouldShow = y > 600;
      if (shouldShow === barVisible) return;
      barVisible = shouldShow;
      if (shouldShow) quickBar.removeAttribute('hidden');
      else quickBar.setAttribute('hidden', '');
    };
    window.addEventListener('scroll', updateQuickBar, { passive: true });
    updateQuickBar();
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

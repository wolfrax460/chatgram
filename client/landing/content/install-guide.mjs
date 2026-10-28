/**
 * Copy for the "install guide" dialogs that open when a visitor clicks a
 * download button.
 *
 * The dialogs are rendered at build time (real HTML) and enhanced by
 * src/site.js, which opens them with <dialog>.showModal(). With JavaScript
 * disabled the same buttons are ordinary links to the real download files.
 *
 * Sizes, versions and checksums are NOT stored here: templates.mjs fills the
 * {version} / {sizeMB} / {sizeBytes} / {sha} tokens from content/site.mjs
 * RELEASES at build time.
 */

/**
 * The Windows installer is also served directly by the Chatgram API host. The
 * dialog offers that direct URL so a visitor still gets the file even when the
 * landing proxy is having a bad day.
 */
export const DIRECT_DOWNLOADS = {
  windows: 'https://chatgram.duckdns.org/downloads/chatgram-windows-setup.exe',
};

export const INSTALL_GUIDE = {
  en: {
    close: 'Close',
    kicker: 'Install guide',
    shaLabel: 'SHA-256',
    start: 'Start the download',
    whatTitle: 'What you get',
    what: [
      'Calls: one-to-one and group, audio and video, screen share, TURN relay and in-call diagnostics',
      'Messaging with voice notes, replies, edits, stars and pinned messages',
      '24-hour status with the list of who viewed it',
      'Groups with admins, join-request approval and invite links',
      'Chatgram AI in English, Kinyarwanda, French and Swahili',
      'Notifications on Android and Windows, with the real permission state',
    ],
    noStore: 'No Play Store, no subscription.',
    windows: {
      title: 'Install Chatgram for Windows',
      file: 'Windows installer {version} · {sizeMB} MB ({sizeBytes} bytes)',
      steps: [
        'Choose “Start the download” and open chatgram-windows-setup.exe when it finishes.',
        'SmartScreen may warn because the build is unsigned: choose “More info”, then “Run anyway”.',
        'Follow the installer, then launch Chatgram. It stays in the tray when you close the window.',
        'From this install on, Chatgram updates itself in the background.',
      ],
      verify: 'Check the file: Get-FileHash .\\chatgram-windows-setup.exe -Algorithm SHA256',
    },
    android: {
      title: 'Install Chatgram for Android',
      file: 'Android APK {version} · {sizeMB} MB ({sizeBytes} bytes)',
      steps: [
        'Choose “Start the download” and open the APK when it finishes.',
        'When Android asks, allow “Install unknown apps” for your browser or Files app.',
        'Choose “Install anyway” if Android warns about installing from outside the Play Store.',
        'It installs in place over an earlier Chatgram build signed with the same key.',
      ],
      webInstead: 'Open the web app instead',
    },
  },
  fr: {
    close: 'Fermer',
    kicker: "Guide d'installation",
    shaLabel: 'SHA-256',
    start: 'Lancer le téléchargement',
    whatTitle: 'Ce que vous obtenez',
    what: [
      "Appels : en tête-à-tête et en groupe, audio et vidéo, partage d'écran, relais TURN et diagnostics d'appel",
      'Messagerie avec notes vocales, réponses, modifications, étoiles et messages épinglés',
      'Statuts de 24 h avec la liste de ceux qui les ont vus',
      "Groupes avec administrateurs, approbation des demandes d'adhésion et liens d'invitation",
      'Chatgram AI en français, kinyarwanda, anglais et swahili',
      "Notifications sur Android et Windows, avec le vrai état de l'autorisation",
    ],
    noStore: "Pas de Play Store, pas d'abonnement.",
    windows: {
      title: 'Installer Chatgram pour Windows',
      file: "Programme d'installation Windows {version} · {sizeMB} Mo ({sizeBytes} octets)",
      steps: [
        'Choisissez « Lancer le téléchargement » et ouvrez chatgram-windows-setup.exe à la fin.',
        "SmartScreen peut vous avertir car la version n'est pas signée : choisissez « Plus d'infos », puis « Exécuter quand même ».",
        "Suivez l'installation, puis lancez Chatgram. Il reste dans la zone de notification quand vous fermez la fenêtre.",
        'Après cette installation, Chatgram se met à jour tout seul en arrière-plan.',
      ],
      verify: 'Vérifiez le fichier : Get-FileHash .\\chatgram-windows-setup.exe -Algorithm SHA256',
    },
    android: {
      title: 'Installer Chatgram pour Android',
      file: 'APK Android {version} · {sizeMB} Mo ({sizeBytes} octets)',
      steps: [
        'Choisissez « Lancer le téléchargement » et ouvrez l’APK à la fin.',
        "Quand Android le demande, autorisez « Installer des applications inconnues » pour votre navigateur ou l'application Fichiers.",
        'Choisissez « Installer quand même » si Android vous avertit de l’installation hors Play Store.',
        "Il s'installe par-dessus une version précédente de Chatgram signée avec la même clé.",
      ],
      webInstead: 'Ouvrir plutôt l’application web',
    },
  },
  rw: {
    close: 'Funga',
    kicker: 'Umwongozo wo gushyira',
    shaLabel: 'SHA-256',
    start: 'Tangira gukurura',
    whatTitle: 'Ibyo ubona',
    what: [
      "Guhamagara: umuntu umwe n'itsinda, amajwi n'amashusho, kugabana ecran, relay ya TURN n'isuzuma ry'uhamagara",
      "Ubutumwa bufite ubutumwa bw'amajwi, gusubiza, guhindura, inyenyeri n'ubutumwa bukuru",
      'Status y’amasaha 24 hamwe n’urutonde rw’ababibonye',
      "Amatsinda afite abayobozi, kwemeza abasaba kwinjira na link z'ubutumire",
      'Chatgram AI mu Kinyarwanda, Icyongereza, Igifaransa n’Ikiswahili',
      'Kumenyesha kuri Android na Windows, n’uko uburenganzira buhari',
    ],
    noStore: 'Nta Play Store, nta kwiyandikisha.',
    windows: {
      title: 'Shyira Chatgram kuri Windows',
      file: 'Porogaramu ishyira ya Windows {version} · {sizeMB} MB ({sizeBytes} bytes)',
      steps: [
        'Kanda « Tangira gukurura » hanyuma ufungure chatgram-windows-setup.exe iyo yarangiye.',
        'SmartScreen ishobora kukuburira kuko ubwubatsi butarashyiriweho umukono: hitamo « Andi makuru », hanyuma « Komeza ».',
        'Kurikiza porogaramu ishyira, hanyuma utangire Chatgram. Iguma muri tray iyo ufunze idirishya.',
        'Nyuma y’iri shyirwa, Chatgram yivugurura yonyine mu buryo bwihishe.',
      ],
      verify: 'Genzura dosiye: Get-FileHash .\\chatgram-windows-setup.exe -Algorithm SHA256',
    },
    android: {
      title: 'Shyira Chatgram kuri Android',
      file: 'APK ya Android {version} · {sizeMB} MB ({sizeBytes} bytes)',
      steps: [
        'Kanda « Tangira gukurura » hanyuma ufungure APK iyo yarangiye.',
        'Iyo Android ibisabye, emeza « Shyira porogaramu zitazwi » ku mushakishamakuru cyangwa porogaramu ya dosiye.',
        'Hitamo « Shyira nubwo » niba Android ikuburira ku gushyira hanze ya Play Store.',
        'Yishyira hejuru y’ubwubatsi bwa Chatgram bwa mbere bufite umukono umwe.',
      ],
      webInstead: 'Fungura urubuga aho kuyishyira',
    },
  },
  sw: {
    close: 'Funga',
    kicker: 'Mwongozo wa usakinishaji',
    shaLabel: 'SHA-256',
    start: 'Anza kupakua',
    whatTitle: 'Unachopata',
    what: [
      'Simu: mtu mmoja na kikundi, sauti na video, kushiriki skrini, relay ya TURN na uchunguzi wa simu',
      'Ujumbe wenye ujumbe wa sauti, majibu, uhariri, nyota na ujumbe uliobandikwa',
      'Hali ya saa 24 pamoja na orodha ya walioiona',
      'Vikundi vyenye wasimamizi, kuidhinisha maombi ya kujiunga na viungo vya mwaliko',
      'Chatgram AI kwa Kiswahili, Kiingereza, Kinyarwanda na Kifaransa',
      'Arifa kwenye Android na Windows, pamoja na hali halisi ya idhini',
    ],
    noStore: 'Hakuna Play Store, hakuna usajili.',
    windows: {
      title: 'Sakinisha Chatgram kwa Windows',
      file: 'Kisakinishi cha Windows {version} · {sizeMB} MB ({sizeBytes} baiti)',
      steps: [
        'Chagua « Anza kupakua » na ufungue chatgram-windows-setup.exe ikishamaliza.',
        'SmartScreen inaweza kukuonya kwa sababu toleo halijatiwa sahihi: chagua « Maelezo zaidi », kisha « Endesha hata hivyo ».',
        'Fuata kisakinishi, kisha fungua Chatgram. Hubaki kwenye tray unapofunga dirisha.',
        'Baada ya usakinishaji huu, Chatgram hujisasisha yenyewe nyuma ya pazia.',
      ],
      verify: 'Thibitisha faili: Get-FileHash .\\chatgram-windows-setup.exe -Algorithm SHA256',
    },
    android: {
      title: 'Sakinisha Chatgram kwa Android',
      file: 'APK ya Android {version} · {sizeMB} MB ({sizeBytes} baiti)',
      steps: [
        'Chagua « Anza kupakua » na ufungue APK ikishamaliza.',
        'Android inapouliza, ruhusu « Sakinisha programu zisizojulikana » kwa kivinjari au programu ya Faili.',
        'Chagua « Sakinisha hata hivyo » ikiwa Android itakuonya kuhusu kusakinisha nje ya Play Store.',
        'Husakinisha juu ya toleo la awali la Chatgram lenye ufunguo uleule wa sahihi.',
      ],
      webInstead: 'Fungua programu ya wavuti badala yake',
    },
  },
};

/** French landing page copy (served at "/fr/"). */
export default {
  code: "fr",
  meta: {
    // 50 characters
    title: "Chatgram : messagerie gratuite Android et Windows",
    // 120 characters
    description:
      "Chatgram est une messagerie gratuite pour Android, Windows et le web : groupes, statuts de 24 h, appels et Chatgram AI.",
    ogImageAlt:
      "Icône de Chatgram à côté d'une conversation avec Chatgram AI, avec le texte « messagerie gratuite pour Android, Windows et le web »",
  },
  ui: {
    skipToContent: "Aller au contenu",
    mainNavigation: "Navigation principale",
    languageLabel: "Langue",
    toggleMenu: "Ouvrir le menu",
    themeGroup: "Thème de couleur",
    themeLight: "Thème clair",
    themeDark: "Thème sombre",
    themeSystem: "Thème système",
    openApp: "Ouvrir Chatgram",
  },
  hero: {
    badge: "Gratuit · Sans publicité · Un compte partout",
    h1: "Chatgram : la <em>messagerie gratuite</em> pour Android, Windows et le web",
    lead: "Chatgram vous rapproche des personnes qui comptent : discussions en temps réel, notes vocales, photos, groupes, statuts de 24 h, appels audio et vidéo, et Chatgram AI pour vos questions et vos textes. Un compte partout, et l'application parle français, kinyarwanda, anglais et swahili — les numéros rwandais +250 fonctionnent dans les contacts et les paramètres du compte.",
    ctaPrimary: { label: "Ouvrir Chatgram dans le navigateur", href: "/web/" },
    ctaSecondary: { label: "Télécharger l'application", href: "#download" },
    platformAndroid: "Android",
    platformWindows: "Windows",
    platformWeb: "Web — sans installation",
  },
  facts: [
    { title: "3 plateformes", sub: "Android, Windows et le web" },
    { title: "Vérification en deux étapes", sub: "Application d'authentification + codes de secours" },
    { title: "Confidentialité par contact", sub: "Vous décidez de ce que chacun voit" },
    { title: "Sans publicité, sans pistage", sub: "Vos conversations ne sont pas un produit" },
  ],
  nav: {
    links: [
      { href: "#features", label: "Fonctionnalités" },
      { href: "#preview", label: "Aperçu" },
      { href: "#security", label: "Confidentialité" },
      { href: "#download", label: "Téléchargements" },
      { href: "#whats-new", label: "Nouveautés" },
      { href: "#faq", label: "FAQ" },
    ],
  },
  features: {
    eyebrow: "Fonctionnalités",
    title: "Tout ce qu'il faut pour rester en contact",
    lead: "Chaque élément ci-dessous fonctionne déjà dans l'application — rien n'est une promesse.",
    items: [
      {
        title: "Discussion en temps réel",
        body: "Les messages arrivent dès l'envoi, avec accusés de réception et de lecture, indicateur de saisie et envoi qui reprend après une coupure.",
      },
      {
        title: "Des groupes avec de vrais outils",
        body: "Photo de groupe, administrateurs et permissions, approbation des demandes d'adhésion, liens d'invitation révocables, messages épinglés et @mentions.",
      },
      {
        title: "Appels audio et vidéo",
        body: "Appelez une personne ou un groupe entier — audio ou vidéo, jusqu'à 20 personnes, avec micro coupé, caméra, partage d'écran et minuteur.",
      },
      {
        title: "Photos, vidéos, notes vocales et fichiers",
        body: "Envoyez images, vidéos, documents et notes vocales. Les médias s'ouvrent en plein écran et les envois affichent la progression avec reprise.",
      },
      {
        title: "Statuts de 24 heures",
        body: "Partagez une photo, une vidéo ou un message vocal qui disparaît après un jour, et voyez qui l'a consulté.",
      },
      {
        title: "Chatgram AI",
        body: "Chatgram AI se trouve en haut de votre liste de discussions comme un contact : posez vos questions en français, kinyarwanda, anglais ou swahili, recevez des réponses en direct, notez-les ou démarrez une nouvelle discussion.",
      },
      {
        title: "Vérification en deux étapes",
        body: "Protégez votre compte avec une application d'authentification et dix codes de secours à usage unique, et changez votre mot de passe dans les Paramètres.",
      },
      {
        title: "Applications Windows et Android",
        body: "Installez Chatgram pour Windows (zone de notification, badge de barre des tâches, mise à jour automatique) ou l'APK Android — le même compte et les mêmes discussions que dans le navigateur.",
      },
    ],
  },
  preview: {
    eyebrow: "Aperçu",
    title: "Regardez à l'intérieur",
    lead: "La même application sur chaque plateforme, pensée pour être familière dès le premier geste.",
    shots: [
      {
        shot: "chats",
        alt: "Chatgram en thème sombre montrant la liste des discussions avec Chatgram AI en haut, un groupe et des badges de messages non lus",
        caption: "Vos discussions, avec Chatgram AI en haut",
      },
      {
        shot: "conversation",
        alt: "Une conversation Chatgram en thème sombre montrant des messages envoyés avec les accusés de réception et de lecture",
        caption: "Discussion en direct avec accusés de réception et de lecture",
      },
    ],
    wide: {
      shot: "ai",
      alt: "Chatgram AI ouverte comme une conversation normale dans l'application Chatgram",
      caption: "Chatgram AI est une conversation comme les autres",
    },
  },
  privacy: {
    eyebrow: "Confidentialité",
    title: "Vos conversations restent les vôtres",
    lead: "Une confidentialité concrète, visible et contrôlable — pas du langage marketing.",
    items: [
      {
        title: "Chiffrées en transit",
        body: "Chaque requête et chaque connexion passe par HTTPS et WSS avec un certificat TLS valide, renouvelé automatiquement.",
      },
      {
        title: "Vérification en deux étapes",
        body: "Ajoutez une application d'authentification à votre compte, avec dix codes de secours à usage unique si vous perdez le téléphone.",
      },
      {
        title: "Confidentialité, par personne",
        body: "Statut en ligne, dernière connexion, photo, à propos, téléphone et e-mail : chacun peut être désactivé — et les accusés de lecture sont facultatifs.",
      },
      {
        title: "Des sessions que vous contrôlez",
        body: "Voyez chaque appareil connecté et déconnectez les autres d'un geste. Changer votre mot de passe les déconnecte automatiquement.",
      },
      {
        title: "Bloquer, masquer et signaler",
        body: "Les comptes bloqués ne peuvent plus vous écrire ni vous appeler. Les signalements arrivent dans une vraie boîte de réception.",
      },
      {
        title: "Protégées côté serveur",
        body: "Les règles de discussion, de rôle et de confidentialité sont appliquées par le serveur, jamais confiées à l'application. Les connexions sont limitées en débit et les échecs répétés bloquent temporairement le compte.",
      },
    ],
    note: "Les messages sont chiffrés en transit et stockés sur le serveur, qui peut donc les lire. Le chiffrement de bout en bout est le premier point de la feuille de route — nous ne l'annoncerons pas avant sa mise en service.",
  },
  downloads: {
    eyebrow: "Téléchargements",
    title: "Télécharger Chatgram pour Android, Windows ou le web",
    lead: "Un seul compte pour les trois. Commencez sur le téléphone, continuez sur l'ordinateur.",
    versionLabel: "Version",
    sizeLabel: "Taille",
    releasedLabel: "Publié",
    fileLabel: "Fichier",
    shaLabel: "SHA-256",
    requiresLabel: "Configuration",
    bytesSuffix: "octets",
    checksumNote: "Les sommes de contrôle identifient le fichier publié — vérifiez la valeur complète avant d'installer.",
    cachedNote:
      "Affichage de la dernière version publiée pendant que le flux des versions est indisponible. Vérifiez la version ci-dessous avant d'installer.",
    windows: {
      label: "Windows",
      title: "Chatgram pour Windows",
      meta: "Programme d'installation · Non signé",
      cta: "Télécharger pour Windows",
      note: "Si Windows SmartScreen vous avertit, choisissez « Plus d'infos » puis « Exécuter quand même ».",
      alt: "Windows 10 ou plus récent, 64 bits · se met à jour depuis /downloads.",
      steps: [
        "Téléchargez et lancez le programme d'installation.",
        "SmartScreen peut vous avertir car la version n'est pas signée — cliquez sur « Plus d'infos » → « Exécuter quand même ».",
        "Vérifiez le fichier avec Get-FileHash .\\chatgram-windows-setup.exe -Algorithm SHA256.",
        "Chatgram démarre et reste dans la zone de notification quand vous le fermez ; les mises à jour s'installent automatiquement.",
      ],
    },
    android: {
      label: "Android",
      title: "Chatgram pour Android",
      meta: "APK · Signature de test",
      cta: "Télécharger l'APK",
      note: "Autorisez « Installer des applications inconnues » pour votre navigateur ou l'application Fichiers quand Android le demande.",
      alt: "Installation manuelle uniquement · la caméra et le microphone ne sont demandés que pour un appel ou une note vocale.",
      steps: [
        "Téléchargez l'APK, puis autorisez « Installer des applications inconnues » pour votre navigateur ou l'application Fichiers.",
        "Ouvrez le fichier, installez-le et lancez Chatgram.",
        "Il s'agit d'une version en téléchargement direct, pas d'une publication sur le Play Store.",
      ],
      qrAlt: "QR code qui ouvre le téléchargement de l'APK Android de Chatgram",
      qrCaption: "Scannez pour installer",
    },
    web: {
      label: "Web",
      title: "Chatgram dans votre navigateur",
      meta: "Sans installation · Navigateur récent",
      body: "Le même compte et les mêmes discussions — ouvrez l'application web dans un navigateur récent. Rien à télécharger.",
      cta: "Ouvrir dans le navigateur",
      alt: "Chrome, Edge, Firefox ou Safari.",
      steps: [
        "Ouvrez Chatgram dans ce navigateur.",
        "Connectez-vous avec le même compte que sur votre téléphone ou votre PC.",
      ],
    },
  },
  steps: {
    eyebrow: "Démarrage",
    title: "Trois étapes pour commencer",
    lead: "Du premier lancement à votre premier message en moins d'une minute.",
    items: [
      {
        title: "Créez votre compte",
        body: "Inscrivez-vous avec votre adresse e-mail ou continuez avec Google. Nous envoyons un code à 6 chiffres pour confirmer votre identité.",
      },
      {
        title: "Ajoutez vos contacts",
        body: "Recherchez une personne par nom, e-mail ou numéro de téléphone et ajoutez-la. Votre liste de contacts reste privée.",
      },
      {
        title: "Commencez à discuter",
        body: "Touchez un contact pour dire bonjour. Envoyez des photos et des notes vocales, ou créez un groupe pour parler à plusieurs personnes.",
      },
    ],
  },
  whatsNew: {
    eyebrow: "Nouveautés",
    title: "Notes de version",
    lead: "Tout ce qui est arrivé dans la version actuelle.",
    platformLabels: { windows: "Windows", android: "Android", web: "Web" },
    releases: [
      {
        platform: "web",
        version: "1.1.0",
        date: "25 octobre 2026",
        items: [
          "Chatgram AI comme conversation standard, avec les @mentions de groupe",
          "Appels audio et vidéo en tête-à-tête et en groupe",
          "Outils de modération, demandes de données et tableau de bord d'administration",
        ],
      },
      {
        platform: "windows",
        version: "1.1.1",
        date: "25 octobre 2026",
        items: [
          "Application de bureau avec zone de notification, badge et mise à jour automatique depuis /downloads",
          "Lancement à la connexion et notifications natives",
          "Version non signée — lisez le guide SmartScreen avant d'installer",
        ],
      },
      {
        platform: "android",
        version: "1.1.2",
        date: "27 octobre 2026",
        items: [
          "Correction du plantage au démarrage (« Chatgram s'arrête ») : la classe de lancement et la configuration embarquée correspondent maintenant",
          "Version optimisée plus légère (1,1 Mo) avec la même clé de signature, elle s'installe par-dessus la 1.1.0",
          "Le clavier ne masque plus la zone de message et une page hors connexion explique quand le serveur est injoignable",
        ],
      },
    ],
  },
  faq: {
    eyebrow: "FAQ",
    title: "Les questions sur Chatgram, avec des réponses",
    lead: "Si votre question n'est pas ici, posez-la dans l'application et nous l'ajouterons.",
    items: [
      {
        q: "Chatgram est-il gratuit ?",
        a: "Oui. Pas de publicité, pas d'abonnement, pas d'achat intégré et pas d'offre premium.",
      },
      {
        q: "Faut-il un compte séparé pour chaque appareil ?",
        a: "Non. Un compte fonctionne sur Android, Windows et le web. Connectez-vous avec le même e-mail sur chaque appareil et vos discussions sont déjà là.",
      },
      {
        q: "Comment télécharger l'application Chatgram ?",
        a: "Utilisez la section Téléchargements de cette page : « Télécharger pour Windows » donne le programme d'installation de 78 Mo et « Télécharger l'APK » donne la version Android de 3,9 Mo. Les deux liens pointent vers les fichiers actuels publiés sous /downloads/.",
      },
      {
        q: "Chatgram est-il disponible au Rwanda ?",
        a: "Oui. Chatgram fonctionne sur n'importe quel téléphone Android ou PC Windows, prend en charge le français, le kinyarwanda, l'anglais et le swahili, et accepte les numéros rwandais +250 dans les contacts et les paramètres du compte.",
      },
      {
        q: "Comment installer l'application Android ?",
        a: "Téléchargez l'APK, ouvrez-le et autorisez « Installer des applications inconnues » pour votre navigateur ou gestionnaire de fichiers quand Android le demande. Chatgram n'est pas encore distribué sur le Play Store, c'est donc normal. Toutes les étapes sont dans le guide Android.",
      },
      {
        q: "Windows affiche un avertissement au démarrage. Est-ce normal ?",
        a: "Oui. Le programme d'installation n'est pas encore signé, SmartScreen peut donc vous avertir la première fois. Choisissez « Plus d'infos » puis « Exécuter quand même ». Le guide Windows donne les étapes exactes et comment vérifier le fichier.",
      },
      {
        q: "Qu'est-ce que Chatgram AI et quelles langues parle-t-elle ?",
        a: "Chatgram AI répond aux questions, aide à rédiger et traduit entre le français, le kinyarwanda, l'anglais et le swahili. Elle peut se tromper, et les réponses sont traitées par un fournisseur d'IA tiers.",
      },
      {
        q: "Mes messages sont-ils chiffrés de bout en bout ?",
        a: "Pas encore. Les messages sont chiffrés en transit (HTTPS/WSS) et stockés sur le serveur, qui peut donc les lire. Le chiffrement de bout en bout est le premier point de la feuille de route.",
      },
      {
        q: "Puis-je passer des appels ?",
        a: "Oui — les appels audio et vidéo sont intégrés. Touchez l'icône téléphone ou caméra dans l'en-tête d'une discussion. Une discussion privée appelle une personne ; un appel de groupe peut réunir jusqu'à 20 personnes.",
      },
    ],
    guidesTitle: "Guides pas à pas",
  },
  footer: {
    tagline: "Une messagerie simple et fiable sur tous vos appareils.",
    productTitle: "Produit",
    product: [
      { href: "#features", label: "Fonctionnalités" },
      { href: "#preview", label: "Aperçu" },
      { href: "#download", label: "Téléchargements" },
      { href: "/web/", label: "Ouvrir l'application web" },
    ],
    helpTitle: "Aide",
    help: [
      { href: "#how", label: "Démarrage" },
      { href: "#faq", label: "FAQ" },
    ],
    guidesTitle: "Guides",
    legalTitle: "Mentions légales",
    legal: [{ href: "/docs/", label: "Conditions et confidentialité" }],
    languageTitle: "Langue",
    bottom: "© {year} Chatgram. Tous droits réservés.",
    stack: "Chatgram pour Android · Windows · le web",
  },
};

/** French landing page copy (served at "/fr/"). */
export default {
  code: 'fr',
  meta: {
    // 50 characters
    title: 'Chatgram : messagerie gratuite Android et Windows',
    // 133 characters
    description:
      'Chatgram est une messagerie gratuite pour Android, Windows et le web : groupes, statuts de 24 h, appels audio et vidéo et Chatgram AI.',
    ogImageAlt:
      "Icône de Chatgram à côté d'une conversation avec Chatgram AI, avec le texte « messagerie gratuite pour Android, Windows et le web »",
  },
  ui: {
    skipToContent: 'Aller au contenu',
    mainNavigation: 'Navigation principale',
    toggleMenu: 'Ouvrir le menu',
    themeGroup: 'Thème de couleur',
    themeLight: 'Thème clair',
    themeDark: 'Thème sombre',
    themeSystem: 'Thème système',
    openApp: 'Ouvrir Chatgram',
  },
  hero: {
    badge: 'Gratuit · Sans publicité · Un compte partout',
    h1: 'Chatgram : la <em>messagerie gratuite</em> pour Android, Windows et le web',
    lead: "Chatgram vous rapproche des personnes qui comptent : discussions en temps réel avec notes vocales et médias, groupes avec demandes d'adhésion, statuts de 24 h, appels audio et vidéo, et Chatgram AI pour vos questions et vos textes. Un compte partout, en français, kinyarwanda, anglais et swahili.",
    ctaPrimary: { label: 'Ouvrir Chatgram dans le navigateur', href: '/web/' },
    ctaSecondary: { label: "Télécharger l'application", href: '#download' },
    platformAndroid: 'Android',
    platformWindows: 'Windows',
    platformWeb: 'Web — sans installation',
    photo: {
      alt: "Cinq amis qui rient ensemble en regardant un téléphone",
      caption: 'Photo d’illustration — des amis partagent un téléphone. Pas une capture de l’application.',
      label: 'Photo',
    },
  },
  facts: [
    { title: 'Appels intégrés', sub: 'Audio, vidéo et partage d’écran' },
    { title: 'Quatre langues', sub: 'Français, kinyarwanda, anglais, swahili' },
    { title: 'Vérification en deux étapes', sub: "Application d'authentification + codes de secours" },
    { title: 'Sans publicité, sans pistage', sub: 'Vos conversations ne sont pas un produit' },
  ],
  nav: {
    links: [
      { href: '#features', label: 'Fonctionnalités' },
      { href: '#calls', label: 'Appels' },
      { href: '#preview', label: 'Aperçu' },
      { href: '#security', label: 'Confidentialité' },
      { href: '#download', label: 'Téléchargements' },
      { href: '#faq', label: 'FAQ' },
    ],
  },
  features: {
    eyebrow: 'Fonctionnalités',
    title: "Tout ce qu'il faut pour rester en contact",
    lead: "Chaque élément ci-dessous fonctionne déjà dans l'application — rien n'est une promesse.",
    items: [
      {
        title: 'La messagerie dans le détail',
        body: 'Messages en temps réel avec accusés de réception et de lecture, notes vocales, photos et fichiers, réponses, modifications, étoiles, recherche et messages épinglés de groupe.',
      },
      {
        title: 'Des appels adaptés au moment',
        body: "Appels en tête-à-tête et en groupe, audio ou vidéo, avec partage d'écran, micro coupé, contrôle de la caméra et minuteur en direct. Un appel de groupe réunit jusqu'à 12 personnes, dont 6 en vidéo.",
      },
      {
        title: 'Des statuts qui disent qui a vu',
        body: 'Partagez une photo, une vidéo ou un message vocal qui disparaît après 24 heures — et voyez exactement qui l’a consulté, du plus récent au plus ancien.',
      },
      {
        title: 'Des groupes avec de vrais contrôles',
        body: "Photo de groupe, administrateurs et permissions, approbation des demandes d'adhésion, liens d'invitation, messages épinglés et @mentions.",
      },
      {
        title: 'Chatgram AI, comme une discussion',
        body: 'Chatgram AI apparaît dans votre liste de discussions comme un contact : posez vos questions en français, kinyarwanda, anglais ou swahili, recevez des réponses en direct, notez-les, ou mentionnez @Chatgram AI dans un groupe.',
      },
      {
        title: 'Des notifications qui arrivent',
        body: "Notifications Android et Windows avec le vrai état de l'autorisation, une notification de test, des canaux séparés pour les messages et les appels, et une plage Ne pas déranger.",
      },
      {
        title: 'Une confidentialité réglable',
        body: "Vérification en deux étapes avec codes de secours, sessions que vous pouvez déconnecter, réglages de confidentialité par personne et accusés de lecture facultatifs. Les messages sont chiffrés en transit — pas de bout en bout, et cette page le dit.",
      },
      {
        title: 'Applications Windows et Android',
        body: "Les deux applications se mettent à jour : Android cherche un APK plus récent, le télécharge, vérifie la somme de contrôle et vous propose de l'installer ; Windows vérifie en arrière-plan et redémarre pour se mettre à jour.",
      },
    ],
  },
  calls: {
    eyebrow: 'Appels',
    title: 'Des appels qui fonctionnent — et qui le disent quand ce n’est pas le cas',
    lead: "Audio ou vidéo, une personne ou tout un groupe, sur les trois plateformes. L'écran d'appel montre ce qui se passe vraiment au lieu de vous laisser deviner.",
    items: [
      {
        title: 'En tête-à-tête et en groupe',
        body: "Appelez un contact depuis l'en-tête de la discussion ou lancez un appel de groupe. Un appel de groupe réunit jusqu'à 12 personnes ; les 6 premières peuvent utiliser la vidéo et les autres rejoignent en audio.",
      },
      {
        title: 'Audio et vidéo',
        body: "Démarrez en audio ou en vidéo, coupez le micro, désactivez la caméra et passez de l'écouteur au haut-parleur ou au Bluetooth sur Android.",
      },
      {
        title: 'Partage d’écran',
        body: "Partagez une fenêtre ou un onglet pendant l'appel lorsque le navigateur ou l'application de bureau le permet, avec une barre de partage claire côté destinataire.",
      },
      {
        title: 'Relais TURN pour les réseaux difficiles',
        body: "Chatgram génère des identifiants TURN à durée limitée pour les appels qui ne peuvent pas se connecter directement, afin que les NAT stricts et les réseaux mobiles aient un relais de secours. Si un relais est injoignable, les diagnostics le signalent.",
      },
      {
        title: 'Diagnostics et reprise en cas d’absence de média',
        body: "L'écran d'appel indique l'état ICE, la paire de candidats, la présence d'un relais configuré, les octets entrants et sortants et le nombre de pistes distantes actives. Quand aucun média n'arrive, Chatgram relance la connexion et affiche la raison.",
      },
    ],
    note: "Les appels sont pair-à-pair avec un relais TURN de secours. La qualité dépend des deux réseaux — les diagnostics servent à expliquer un mauvais appel plutôt qu'à le deviner.",
  },
  messaging: {
    eyebrow: 'Messagerie',
    title: 'Les petits détails qui rendent la discussion agréable',
    lead: 'La même conversation sur chaque appareil, avec les contrôles du quotidien.',
    items: [
      {
        title: 'Notes vocales',
        body: "Enregistrez une note vocale en un geste et envoyez-la ; elle se lit directement dans la conversation avec sa durée.",
      },
      {
        title: 'Réponses, modifications et suppressions',
        body: "Répondez à un message précis, modifiez votre texte avec la mention « modifié », supprimez pour vous ou pour tout le monde.",
      },
      {
        title: 'Étoiles et épingles',
        body: 'Marquez des messages d’une étoile pour les retrouver, et épinglez un message important en haut d’un groupe.',
      },
      {
        title: 'Recherche et médias partagés',
        body: 'Cherchez dans vos discussions et ouvrez les photos, vidéos et liens d’une conversation au même endroit.',
      },
      {
        title: 'Photos, vidéos et fichiers',
        body: "Envoyez images, vidéos et documents avec une vraie progression d'envoi et une reprise qui conserve le fichier.",
      },
    ],
    note: 'Les accusés de lecture et de réception font partie de la conversation — et vous pouvez désactiver les accusés de lecture.',
    photo: {
      alt: 'Deux amies assises qui rient en regardant quelque chose sur un téléphone',
      caption: 'Photo d’illustration — deux amies partagent un moment. Pas une capture de l’application.',
      label: 'Photo',
    },
  },
  preview: {
    eyebrow: 'Aperçu',
    title: 'Regardez à l’intérieur',
    lead: 'La même application sur chaque plateforme, pensée pour être familière dès le premier geste.',
    shots: [
      {
        shot: 'chats',
        alt: 'Chatgram en thème sombre montrant la liste des discussions avec un groupe, des contacts et des badges de messages non lus',
        caption: 'Vos discussions, avec Chatgram AI dans la liste',
      },
      {
        shot: 'conversation',
        alt: 'Une conversation Chatgram en thème sombre montrant des messages envoyés avec les accusés de réception et de lecture',
        caption: 'Discussion en direct avec accusés de réception et de lecture',
      },
    ],
    wide: {
      shot: 'ai',
      alt: 'Chatgram AI ouverte comme une conversation normale dans l’application Chatgram',
      caption: 'Chatgram AI est une conversation comme les autres',
    },
  },
  privacy: {
    eyebrow: 'Confidentialité',
    title: 'Vos conversations restent les vôtres',
    lead: 'Une confidentialité concrète, visible et contrôlable — pas du langage marketing.',
    items: [
      {
        title: 'Chiffrées en transit',
        body: 'Chaque requête et chaque connexion passe par HTTPS et WSS avec un certificat TLS valide, renouvelé automatiquement.',
      },
      {
        title: 'Vérification en deux étapes',
        body: "Ajoutez une application d'authentification à votre compte, avec dix codes de secours à usage unique si vous perdez le téléphone.",
      },
      {
        title: 'Confidentialité, par personne',
        body: 'Statut en ligne, dernière connexion, photo, à propos, téléphone et e-mail : chacun peut être désactivé — et les accusés de lecture sont facultatifs.',
      },
      {
        title: 'Des sessions que vous contrôlez',
        body: 'Voyez chaque appareil connecté et déconnectez les autres d’un geste. Changer votre mot de passe les déconnecte automatiquement.',
      },
      {
        title: 'Des signalements lus par une personne',
        body: "Les signalements arrivent dans une boîte de réception d'administration, et le contenu signalé peut être examiné par des membres autorisés de l'équipe. Chaque action d'administration est consignée dans un journal d'audit, et les comptes bloqués ne peuvent plus vous écrire ni vous appeler.",
      },
      {
        title: 'Protégées côté serveur',
        body: 'Les règles de discussion, de rôle et de confidentialité sont appliquées par le serveur, jamais confiées à l’application. Les connexions sont limitées en débit et les échecs répétés bloquent temporairement le compte.',
      },
    ],
    note: 'Les messages sont chiffrés en transit et stockés sur le serveur, qui peut donc les lire. Le chiffrement de bout en bout est le premier point de la feuille de route — nous ne l’annoncerons pas avant sa mise en service.',
  },
  downloads: {
    eyebrow: 'Téléchargements',
    title: 'Télécharger Chatgram pour Android, Windows ou le web',
    lead: 'Un seul compte pour les trois. Commencez sur le téléphone, continuez sur l’ordinateur.',
    stripLabel: 'Versions publiées actuellement',
    versionLabel: 'Version',
    sizeLabel: 'Taille',
    releasedLabel: 'Publié',
    fileLabel: 'Fichier',
    shaLabel: 'SHA-256',
    requiresLabel: 'Configuration',
    bytesSuffix: 'octets',
    checksumNote: 'Les sommes de contrôle identifient le fichier publié — vérifiez la valeur complète avant d’installer.',
    cachedNote:
      'Affichage de la dernière version publiée pendant que le flux des versions est indisponible. Vérifiez la version ci-dessous avant d’installer.',
    windows: {
      label: 'Windows',
      title: 'Chatgram pour Windows',
      meta: "Programme d'installation · Non signé",
      cta: 'Télécharger pour Windows',
      note: 'Si Windows SmartScreen vous avertit, choisissez « Plus d’infos » puis « Exécuter quand même ».',
      alt: 'Windows 10 ou plus récent, 64 bits · se met à jour depuis /downloads.',
      steps: [
        "Téléchargez et lancez le programme d'installation.",
        'SmartScreen peut vous avertir car la version n’est pas signée — cliquez sur « Plus d’infos » → « Exécuter quand même ».',
        'Vérifiez le fichier avec Get-FileHash .\\chatgram-windows-setup.exe -Algorithm SHA256.',
        'Chatgram démarre et reste dans la zone de notification quand vous le fermez ; les mises à jour s’installent automatiquement.',
      ],
    },
    android: {
      label: 'Android',
      title: 'Chatgram pour Android',
      meta: 'APK · Signature de test',
      cta: 'Télécharger l’APK',
      note: 'Autorisez « Installer des applications inconnues » pour votre navigateur ou l’application Fichiers quand Android le demande.',
      alt: 'Installation manuelle uniquement · la caméra et le microphone ne sont demandés que pour un appel ou une note vocale.',
      steps: [
        'Téléchargez l’APK, puis autorisez « Installer des applications inconnues » pour votre navigateur ou l’application Fichiers.',
        'Ouvrez le fichier, installez-le et lancez Chatgram.',
        'Il s’agit d’une version en téléchargement direct, pas d’une publication sur le Play Store. Chatgram se met à jour ensuite tout seul.',
      ],
      qrAlt: 'QR code qui ouvre le téléchargement de l’APK Android de Chatgram',
      qrCaption: 'Scannez pour installer',
    },
    web: {
      label: 'Web',
      title: 'Chatgram dans votre navigateur',
      meta: 'Sans installation · Navigateur récent',
      body: 'Le même compte et les mêmes discussions — ouvrez l’application web dans un navigateur récent. Rien à télécharger.',
      cta: 'Ouvrir dans le navigateur',
      alt: 'Chrome, Edge, Firefox ou Safari.',
      steps: [
        'Ouvrez Chatgram dans ce navigateur.',
        'Connectez-vous avec le même compte que sur votre téléphone ou votre PC.',
      ],
    },
  },
  steps: {
    eyebrow: 'Démarrage',
    title: 'Trois étapes pour commencer',
    lead: 'Du premier lancement à votre premier message en moins d’une minute.',
    items: [
      {
        title: 'Créez votre compte',
        body: 'Inscrivez-vous avec votre adresse e-mail ou continuez avec Google. Nous envoyons un code à 6 chiffres pour confirmer votre identité.',
      },
      {
        title: 'Ajoutez vos contacts',
        body: 'Recherchez une personne par nom, e-mail ou numéro de téléphone et ajoutez-la. Votre liste de contacts reste privée.',
      },
      {
        title: 'Commencez à discuter',
        body: 'Touchez un contact pour dire bonjour, envoyez une photo ou une note vocale, créez un groupe ou appelez-le — en audio ou en vidéo.',
      },
    ],
  },
  whatsNew: {
    eyebrow: 'Nouveautés',
    title: 'Notes de version',
    lead: 'Tout ce qui est arrivé dans les versions actuelles.',
    platformLabels: { windows: 'Windows', android: 'Android', web: 'Web' },
    releases: [
      {
        platform: 'android',
        version: '1.1.7',
        date: '27 octobre 2026',
        items: [
          'Notifications push via Firebase Cloud Messaging (FCM) : les messages et les appels arrivent même quand Chatgram est fermé ou en arrière-plan.',
          'Appel entrant en plein écran : un appel entrant réveille l’écran avec un écran Répondre / Refuser plein écran (y compris sur l’écran de verrouillage) au lieu d’une petite bannière.',
          'Diagnostics d’appel : un nouvel écran enregistre la qualité de la connexion, le chemin ICE/relais et la cause de l’échec, pour analyser un appel coupé ou silencieux.',
        ],
      },
      {
        platform: 'windows',
        version: '1.1.2',
        date: '27 octobre 2026',
        items: [
          'Réglages de notifications qui affichent le vrai état des notifications Windows, avec un raccourci vers la page des réglages de notifications.',
          'Alerte d’appel entrant : une notification Windows et une alerte dans la zone de notification annoncent un appel, et un clic ramène Chatgram au premier plan.',
          'Embarque le client web actuel : Chatgram AI comme conversation standard, mentions @Chatgram AI en groupe, statuts et fonctions du tableau de bord d’administration.',
        ],
      },
      {
        platform: 'android',
        version: '1.1.6',
        date: '27 octobre 2026',
        items: [
          'Réglages de notifications qui affichent le vrai état de l’autorisation, ouvrent les réglages Android et envoient une notification de test',
          'Une invite pour désactiver l’optimisation de la batterie, afin qu’Android ne retarde plus les notifications',
          'Un canal d’appel avec sonnerie et un sélecteur natif haut-parleur / écouteur / Bluetooth',
          'Appels : la vidéo de l’autre personne démarre seule (un avatar remplace le bouton lecture), « Appel en cours… » devient le chrono dès que quelqu’un rejoint, et l’écran d’appel entrant affiche qui appelle',
        ],
      },
      {
        platform: 'android',
        version: '1.1.5',
        date: '27 octobre 2026',
        items: [
          'Mises à jour dans l’application : Chatgram vérifie s’il existe un APK plus récent, le télécharge en Wi-Fi ou en données mobiles (selon la disponibilité), vérifie la somme de contrôle et propose « Mise à jour prête : touchez pour installer »',
          'Un écran « mise à jour requise » lorsque la version installée n’est plus prise en charge',
          'Aucune installation silencieuse : Android demande une fois l’autorisation de l’installateur, et rien ne s’installe sans un appui',
        ],
      },
      {
        platform: 'windows',
        version: '1.1.1',
        date: '27 octobre 2026',
        items: [
          'Application de bureau avec zone de notification, badge et mise à jour automatique depuis /downloads',
          'Lancement à la connexion et notifications natives',
          'Téléchargement des mises à jour en arrière-plan avec « Redémarrer pour installer » ; l’installation se fait à la fermeture',
          'Un écran de mise à jour bloquant quand une version est imposée ou trop ancienne',
          'Version non signée — lisez le guide SmartScreen avant d’installer',
        ],
      },
      {
        platform: 'android',
        version: '1.1.2',
        date: '27 octobre 2026',
        items: [
          'Correction du plantage au démarrage (« Chatgram s’arrête ») : la classe de lancement et la configuration embarquée correspondent maintenant',
          'Version optimisée plus légère avec la même clé de signature, elle s’installe par-dessus la 1.1.0',
          'Le clavier ne masque plus la zone de message et une page hors connexion explique quand le serveur est injoignable',
        ],
      },
      {
        platform: 'web',
        version: '1.1.0',
        date: '25 octobre 2026',
        items: [
          'Chatgram AI comme conversation standard, avec les @mentions de groupe',
          'Appels audio et vidéo en tête-à-tête et en groupe',
          'Outils de modération, demandes de données et tableau de bord d’administration',
        ],
      },
    ],
  },
  faq: {
    eyebrow: 'FAQ',
    title: 'Les questions sur Chatgram, avec des réponses',
    lead: 'Si votre question n’est pas ici, posez-la dans l’application et nous l’ajouterons.',
    items: [
      {
        q: 'Chatgram est-il gratuit ?',
        a: 'Oui. Pas de publicité, pas d’abonnement, pas d’achat intégré et pas d’offre premium.',
      },
      {
        q: 'Faut-il un compte séparé pour chaque appareil ?',
        a: 'Non. Un compte fonctionne sur Android, Windows et le web. Connectez-vous avec le même e-mail sur chaque appareil et vos discussions sont déjà là.',
      },
      {
        q: 'Comment télécharger l’application Chatgram ?',
        a: 'Utilisez la section Téléchargements de cette page : « Télécharger pour Windows » donne le programme d’installation et « Télécharger l’APK » donne la version Android. Les deux liens pointent vers les fichiers actuels publiés sous /downloads/, et les cartes indiquent la version, la taille et le SHA-256 exacts.',
      },
      {
        q: 'Chatgram est-il disponible au Rwanda ?',
        a: 'Oui. Chatgram fonctionne sur n’importe quel téléphone Android ou PC Windows, prend en charge le français, le kinyarwanda, l’anglais et le swahili, et accepte les numéros rwandais +250 dans les contacts et les paramètres du compte.',
      },
      {
        q: 'Comment installer l’application Android ?',
        a: 'Téléchargez l’APK, ouvrez-le et autorisez « Installer des applications inconnues » pour votre navigateur ou gestionnaire de fichiers quand Android le demande. Chatgram n’est pas encore distribué sur le Play Store, c’est donc normal. Toutes les étapes sont dans le guide Android.',
      },
      {
        q: 'Windows affiche un avertissement au démarrage. Est-ce normal ?',
        a: 'Oui. Le programme d’installation n’est pas encore signé, SmartScreen peut donc vous avertir la première fois. Choisissez « Plus d’infos » puis « Exécuter quand même ». Le guide Windows donne les étapes exactes et comment vérifier le fichier.',
      },
      {
        q: 'Qu’est-ce que Chatgram AI et quelles langues parle-t-elle ?',
        a: 'Chatgram AI répond aux questions, aide à rédiger et traduit entre le français, le kinyarwanda, l’anglais et le swahili. Elle apparaît dans votre liste de discussions comme un contact, et dans un groupe vous pouvez mentionner @Chatgram AI. Elle peut se tromper, et les réponses sont traitées par un fournisseur d’IA tiers.',
      },
      {
        q: 'Les notifications fonctionnent-elles quand l’application est fermée ?',
        a: 'Sur Android 1.1.7 et versions suivantes, les messages et les appels arrivent via Firebase Cloud Messaging même quand Chatgram est fermé ou en arrière-plan. Sur Windows, l’application de bureau affiche les notifications pendant qu’elle fonctionne, y compris depuis la zone de notification.',
      },
      {
        q: 'Mes messages sont-ils chiffrés de bout en bout ?',
        a: 'Pas encore. Les messages sont chiffrés en transit (HTTPS/WSS) et stockés sur le serveur, qui peut donc les lire. Le chiffrement de bout en bout est le premier point de la feuille de route.',
      },
      {
        q: 'Puis-je passer des appels ?',
        a: 'Oui — les appels audio et vidéo sont intégrés. Touchez l’icône téléphone ou caméra dans l’en-tête d’une discussion. Une discussion privée appelle une personne ; un appel de groupe peut réunir jusqu’à 12 personnes, dont 6 en vidéo.',
      },
    ],
    guidesTitle: 'Guides pas à pas',
  },
  footer: {
    tagline: 'Une messagerie simple et fiable sur tous vos appareils.',
    productTitle: 'Produit',
    product: [
      { href: '#features', label: 'Fonctionnalités' },
      { href: '#calls', label: 'Appels' },
      { href: '#preview', label: 'Aperçu' },
      { href: '#download', label: 'Téléchargements' },
      { href: '/web/', label: 'Ouvrir l’application web' },
    ],
    helpTitle: 'Aide',
    help: [
      { href: '#how', label: 'Démarrage' },
      { href: '#whats-new', label: 'Nouveautés' },
      { href: '#faq', label: 'FAQ' },
    ],
    guidesTitle: 'Guides',
    legalTitle: 'Mentions légales',
    legal: [{ href: '/docs/', label: 'Conditions et confidentialité' }],
    bottom: '© {year} Chatgram. Tous droits réservés.',
    stack: 'Chatgram pour Android · Windows · le web',
  },
};

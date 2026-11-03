/**
 * French long-form pages (served as /fr/<slug>/ by the landing build).
 *
 * Copy only: no imports, no logic. Every fact comes from
 * docs/reports/seo-content-brief.md; internal links use only the allowed paths.
 */
export const PAGES = {
  about: {
    slug: 'about',
    title: 'À propos de Chatgram : messagerie gratuite',
    description:
      'Chatgram est une messagerie gratuite conçue au Rwanda pour Android, Windows et le web : trois plateformes, quatre langues et des limites expliquées.',
    h1: 'Chatgram, la messagerie gratuite pensée au Rwanda',
    updated: '3 novembre 2026',
    intro:
      'Chatgram est une messagerie gratuite conçue au Rwanda. Elle réunit sur un seul compte vos discussions directes et de groupe, vos statuts de 24 heures, vos notes vocales et vos appels audio et vidéo, sur Android, Windows et le web. Cette page décrit ce que l’application fait aujourd’hui, à qui elle s’adresse et ce qu’elle ne fait pas encore. Nous préférons écrire les limites noir sur blanc plutôt que de les passer sous silence.',
    sections: [
      {
        h2: 'Qu’est-ce que Chatgram ?',
        html: `<p>Chatgram est une application de messagerie gratuite, sans publicité et sans abonnement. Un même compte, créé avec votre adresse e-mail, vous suit sur Android, sur Windows et dans le navigateur : vous commencez une conversation sur le téléphone et vous la reprenez sur l’ordinateur, avec le même historique et les mêmes contacts.</p>
<p>L’application web s’ouvre sur <a href="/web/">/web/</a> sans rien installer. L’APK Android se télécharge sur <a href="/downloads/chatgram-android.apk">/downloads/chatgram-android.apk</a>, et le programme Windows est expliqué dans le <a href="/guides/chatgram-windows-download-smartscreen.html">guide Windows</a>. L’interface existe en quatre langues : français, kinyarwanda, anglais et swahili.</p>`,
      },
      {
        h2: 'À qui s’adresse Chatgram ?',
        html: `<p>Chatgram s’adresse aux personnes qui veulent un seul compte pour tous leurs appareils, sans publicité ni abonnement. Il convient aussi aux familles, aux amis et aux petits groupes de travail qui ont besoin d’un statut de 24 heures, d’une note vocale rapide ou d’un appel de groupe.</p>
<ul>
<li>Android 7.0 ou plus récent (API 24) pour l’APK.</li>
<li>Windows 10 ou plus récent, en 64 bits, pour l’installateur.</li>
<li>Un navigateur récent (Chrome, Edge, Firefox ou Safari) pour l’application web.</li>
</ul>`,
      },
      {
        h2: 'Ce qui fonctionne aujourd’hui',
        html: `<p>Toutes les fonctions ci-dessous sont disponibles dans les versions actuelles ; aucune n’est une promesse pour plus tard.</p>
<ul>
<li>Discussions directes et de groupe, avec réponses citées et cartes de réponse.</li>
<li>Statuts de 24 heures, qui disparaissent d’eux-mêmes.</li>
<li>Notes vocales avec forme d’onde, pause, verrouillage et lecture à 1,5x ou 2x.</li>
<li>Appels audio et vidéo : jusqu’à 12 personnes, dont 6 en vidéo.</li>
<li>Chatgram AI en français, kinyarwanda, anglais et swahili ; mentionnez @Chatgram AI dans un groupe.</li>
<li>Notifications Android via Firebase Cloud Messaging et notifications dans la zone de notification Windows.</li>
<li>Mode sombre et quatre langues d’interface.</li>
</ul>`,
      },
      {
        h2: 'Ce que Chatgram ne fait pas encore',
        html: `<p>Nous préférons le dire clairement, même quand la réponse n’est pas flatteuse.</p>
<ul>
<li>Les messages sont chiffrés en transit (HTTPS et WSS) et stockés sur le serveur, qui peut donc les lire. Le chiffrement de bout en bout n’est pas encore implémenté.</li>
<li>L’installateur Windows n’est pas signé : SmartScreen peut afficher un avertissement au premier lancement.</li>
<li>L’application Android s’installe à la main, en sideload ; elle n’est pas distribuée sur Google Play.</li>
<li>Chatgram AI peut se tromper, et les réponses sont traitées par un fournisseur d’IA tiers.</li>
</ul>`,
      },
      {
        h2: 'Les trois plateformes, en pratique',
        html: `<ul>
<li><strong>Android 1.1.7</strong> : APK de 1 589 034 octets, pour Android 7.0 ou plus récent.</li>
<li><strong>Windows 1.1.6</strong> : installateur de 86 263 690 octets, pour Windows 10 ou plus récent en 64 bits.</li>
<li><strong>Web 1.1.3</strong> : rien à installer, le même compte dans le navigateur.</li>
</ul>
<p>Les guides pas à pas détaillent l’installation : <a href="/guides/chatgram-android-download-install.html">guide Android</a> et <a href="/guides/chatgram-windows-download-smartscreen.html">guide Windows</a>. Les conditions d’utilisation et la politique de confidentialité sont sur <a href="/docs/">/docs/</a>.</p>`,
      },
    ],
    faq: [
      {
        q: 'Chatgram est-il disponible au Rwanda ?',
        a: 'Oui. Chatgram est conçu au Rwanda et fonctionne sur Android, Windows et le web. L’interface est disponible en kinyarwanda, en français, en anglais et en swahili, et les numéros rwandais au format +250 sont acceptés dans les contacts et les réglages du compte.',
      },
      {
        q: 'Faut-il un compte différent pour chaque appareil ?',
        a: 'Non. Un seul compte, créé avec votre adresse e-mail, fonctionne sur Android, Windows et le web. Connectez-vous avec le même e-mail sur chaque appareil et vous retrouvez les mêmes discussions, les mêmes contacts et le même historique.',
      },
      {
        q: 'Chatgram est-il distribué sur Google Play ?',
        a: 'Pas encore. L’application Android se télécharge directement au format APK depuis /downloads/chatgram-android.apk. Android demande alors d’autoriser « Installer des applications inconnues » pour le navigateur ou le gestionnaire de fichiers : c’est normal pour une installation directe, et le guide Android explique chaque étape.',
      },
    ],
  },

  'is-chatgram-free': {
    slug: 'is-chatgram-free',
    title: 'Chatgram est-il gratuit ? Prix et téléchargements',
    description:
      'Chatgram est gratuit : sans publicité, sans abonnement, sans achat intégré et sans offre premium. Voici ce que cela couvre, et ce que cela ne promet pas.',
    h1: 'Combien coûte Chatgram ? La réponse honnête',
    updated: '3 novembre 2026',
    intro:
      'La réponse est simple : Chatgram est gratuit. Il n’y a ni publicité, ni abonnement, ni achat intégré, ni offre premium. Cette page explique ce que cela couvre exactement, où télécharger l’application sans payer, et ce que le mot « gratuit » ne promet pas. Elle décrit uniquement ce qui est disponible aujourd’hui dans les versions Android 1.1.7, Windows 1.1.6 et web 1.1.3.',
    sections: [
      {
        h2: 'Combien coûte Chatgram ?',
        html: `<p>Zéro. Créer un compte ne coûte rien, et utiliser les discussions, les statuts, les notes vocales, les appels ou Chatgram AI ne coûte rien non plus. Les deux applications se téléchargent sans paiement, et l’application web s’ouvre directement dans le navigateur.</p>
<p>Il n’y a pas de version d’essai limitée dans le temps, pas de crédits à acheter et pas de frais par appareil. Le même compte gratuit fonctionne sur Android, Windows et le web.</p>`,
      },
      {
        h2: 'Ce que Chatgram ne facture pas',
        html: `<p>La liste est courte et nous la gardons courte :</p>
<ul>
<li><strong>Publicité</strong> : aucune publicité dans l’application ni sur le site.</li>
<li><strong>Abonnement</strong> : pas de formule mensuelle ou annuelle.</li>
<li><strong>Achats intégrés</strong> : aucun paiement à effectuer dans l’application.</li>
<li><strong>Offre premium</strong> : pas de niveau payant qui débloquerait des fonctions.</li>
<li><strong>Suppléments</strong> : les appels de groupe et Chatgram AI ne demandent aucun paiement supplémentaire.</li>
</ul>
<p>Aucune fonction n’est bloquée derrière un paiement, et aucune publicité ne s’affiche dans l’application : le service est le même pour tous les comptes.</p>`,
      },
      {
        h2: 'Où télécharger Chatgram gratuitement',
        html: `<p>L’APK Android 1.1.7 fait 1 589 034 octets et demande Android 7.0 ou plus récent (API 24) ; il se télécharge sur <a href="/downloads/chatgram-android.apk">/downloads/chatgram-android.apk</a>. Le <a href="/guides/chatgram-android-download-install.html">guide Android</a> explique l’autorisation « Installer des applications inconnues ».</p>
<p>L’installateur Windows 1.1.6 fait 86 263 690 octets et demande Windows 10 ou plus récent en 64 bits. Il n’est pas signé : le <a href="/guides/chatgram-windows-download-smartscreen.html">guide Windows</a> détaille l’avertissement SmartScreen et la marche à suivre. L’application web 1.1.3 s’ouvre sur <a href="/web/">/web/</a> sans rien installer.</p>`,
      },
      {
        h2: 'Ce que « gratuit » couvre dans l’application',
        html: `<ul>
<li>Discussions directes et de groupe, avec réponses citées et cartes de réponse.</li>
<li>Statuts de 24 heures, visibles par vos contacts et supprimés automatiquement.</li>
<li>Notes vocales avec forme d’onde, pause, verrouillage et lecture à 1,5x ou 2x.</li>
<li>Appels audio et vidéo jusqu’à 12 personnes, dont 6 en vidéo.</li>
<li>Chatgram AI en quatre langues, avec mention @Chatgram AI dans un groupe.</li>
<li>Notifications Android et Windows, mode sombre et quatre langues d’interface.</li>
</ul>`,
      },
      {
        h2: 'Ce que « gratuit » ne promet pas',
        html: `<p>Nous ne promettons ni prix futur ni fonctionnalité à venir. Cette page décrit seulement ce qui existe aujourd’hui, avec les versions Android 1.1.7, Windows 1.1.6 et web 1.1.3 et les fonctions listées ci-dessus. Si quelque chose change, cette page sera mise à jour avec une nouvelle date de révision.</p>
<p>« Gratuit » ne veut pas dire « sans limites techniques ». L’installateur Windows n’est pas signé, l’APK Android s’installe à la main, et Chatgram AI peut se tromper. Ces limites sont expliquées dans les guides et sur la page <a href="/docs/">/docs/</a>.</p>
<p>Les versions actuelles restent gratuites sur les trois plateformes : aucune nouveauté décrite sur cette page n’introduit de paiement.</p>`,
      },
    ],
    faq: [
      {
        q: 'Chatgram est-il vraiment gratuit ?',
        a: 'Oui. Il n’y a ni publicité, ni abonnement, ni achat intégré, ni offre premium. Créer un compte et utiliser les fonctions décrites sur cette page ne demande aucun paiement, sur Android, sur Windows comme dans le navigateur.',
      },
      {
        q: 'Y a-t-il des achats intégrés ou un abonnement ?',
        a: 'Non. L’application ne propose aucun paiement intégré, aucune monnaie virtuelle et aucune fonction réservée à un niveau payant. Les discussions, les statuts, les notes vocales, les appels et Chatgram AI sont utilisables sans payer.',
      },
      {
        q: 'Les applications Android et Windows sont-elles payantes ?',
        a: 'Non. L’APK Android et l’installateur Windows se téléchargent gratuitement depuis les liens indiqués sur cette page. Le même compte gratuit fonctionne ensuite sur Android, Windows et le web, sans frais supplémentaires.',
      },
    ],
  },

  'whats-new': {
    slug: 'whats-new',
    title: 'Nouveautés Chatgram : versions et changements',
    description:
      'Les nouveautés réelles de Chatgram en 2026 : notes vocales, réponses citées, fonds d’écran, notifications Android et Windows, et bien plus.',
    h1: 'Ce qui a réellement changé dans Chatgram',
    updated: '3 novembre 2026',
    intro:
      'Voici les changements réels publiés dans Chatgram en 2026, regroupés par plateforme. Chaque ligne indique ce que la nouveauté change pour vous. Les versions actuelles sont Android 1.1.7, Windows 1.1.6 et web 1.1.3 ; les numéros cités sont ceux des versions où la fonction est arrivée. Aucun changement futur n’est annoncé ici : cette page ne décrit que ce qui est déjà disponible.',
    sections: [
      {
        h2: 'Android 1.1.7 : des notifications même application fermée',
        html: `<p>Les messages et les appels arrivent désormais via Firebase Cloud Messaging, même quand Chatgram est fermé ou en arrière-plan. Concrètement, vous n’avez plus besoin de garder l’application ouverte pour être prévenu d’un message ou d’un appel entrant.</p>
<p>C’est utile quand vous ne voulez pas rouvrir l’application à chaque vérification : vous n’avez donc pas besoin de relancer Chatgram pour savoir qu’un message ou un appel est arrivé.</p>`,
      },
      {
        h2: 'Notes vocales : enregistrer, verrouiller, écouter plus vite',
        html: `<p>Depuis Android 1.1.3, une note vocale se contrôle en la glissant vers la gauche pour l’annuler, en la verrouillant pour continuer à parler sans garder le doigt sur l’écran, ou en la mettant en pause. La forme d’onde s’affiche pendant l’enregistrement et la lecture peut être accélérée à 1,5x ou 2x.</p>
<p>La forme d’onde montre que le microphone capte bien, et la pause évite d’envoyer un fichier trop long ou de recommencer depuis le début quand une phrase est mal partie.</p>`,
      },
      {
        h2: 'Réponses citées, cartes de réponse et fonds d’écran',
        html: `<p>Vous pouvez répondre à un message précis avec une carte de réponse et une citation, ce qui garde le contexte dans les discussions actives. Les fonds d’écran peuvent être choisis pour une discussion en particulier ou pour toute l’application, selon ce que vous préférez.</p>
<p>La citation garde le message d’origine visible, ce qui évite les malentendus quand plusieurs conversations se croisent. Le fond d’écran reste un choix personnel : il ne change rien pour les autres participants.</p>`,
      },
      {
        h2: 'Des réglages repensés, une page par sujet',
        html: `<p>Les réglages ont été reconstruits sous forme de liste, avec une page dédiée par sujet. Vous trouvez plus vite les notifications, la confidentialité, l’apparence ou les informations du compte, sans parcourir un long écran unique.</p>
<p>Les options sont désormais regroupées par sujet plutôt que mélangées : une page pour les notifications, une autre pour le compte, et ainsi de suite.</p>`,
      },
      {
        h2: 'Appels et application Windows 1.1.6',
        html: `<p>L’application Windows 1.1.6 apporte le contrôle à distance de l’écran depuis l’application Windows, et la qualité du partage d’écran a été améliorée. Les appels de groupe restent limités à 12 personnes, dont 6 en vidéo, sur l’ensemble des plateformes.</p>
<p>Ces changements concernent le partage d’écran pendant un appel : l’image partagée est plus nette et le contrôle à distance complète l’assistance à distance.</p>`,
      },
      {
        h2: 'Compte, aide et sécurité',
        html: `<p>La suppression du compte est protégée : elle demande votre mot de passe et un code envoyé par e-mail, avec une période de 14 jours pour annuler la demande. Les signalements d’aide peuvent créer un ticket de suivi pour l’équipe, afin qu’un problème signalé ne reste pas sans réponse.</p>
<p>La double vérification de la suppression évite qu’un simple clic, ou une session laissée ouverte sur un appareil partagé, efface un compte par erreur.</p>`,
      },
    ],
    faq: [
      {
        q: 'Quelle version de Chatgram ai-je ?',
        a: 'Les versions actuelles sont Android 1.1.7, Windows 1.1.6 et web 1.1.3. Chaque plateforme a son propre numéro de version, et les fonctions arrivent parfois d’abord sur l’une d’elles. Cette page indique la version où chaque changement a été publié.',
      },
      {
        q: 'Les nouveautés sont-elles payantes ?',
        a: 'Non. Les mises à jour et les fonctions décrites ici sont gratuites, comme le reste de Chatgram : pas de publicité, pas d’abonnement et pas d’achat intégré.',
      },
      {
        q: 'Où trouver de l’aide si une nouveauté ne fonctionne pas ?',
        a: 'Ouvrez l’aide intégrée à Chatgram et décrivez le problème : les signalements d’aide peuvent créer un ticket de suivi pour l’équipe. Vous pouvez aussi consulter les guides pas à pas du site, dont le guide Android et le guide Windows.',
      },
    ],
  },

  'privacy-and-safety': {
    slug: 'privacy-and-safety',
    title: 'Chatgram : confidentialité et sécurité expliquées',
    description:
      'Ce que Chatgram protège aujourd’hui : TLS en transit, mot de passe, blocage et signalement. Ce qui manque encore : le chiffrement de bout en bout.',
    h1: 'Ce que Chatgram protège — et ce qu’il ne protège pas encore',
    updated: '3 novembre 2026',
    intro:
      'Cette page décrit ce que Chatgram protège réellement aujourd’hui, ce qu’il ne protège pas encore, et comment utiliser l’application plus prudemment. Les messages sont chiffrés en transit, mais le serveur peut lire les messages stockés : le chiffrement de bout en bout n’est pas encore implémenté. Nous ne prétendons pas le contraire, même si ce serait plus rassurant à lire.',
    sections: [
      {
        h2: 'Ce qui est protégé aujourd’hui',
        html: `<ul>
<li><strong>En transit</strong> : les requêtes et les connexions passent par HTTPS et WSS avec un certificat TLS valide.</li>
<li><strong>Votre compte</strong> : l’accès est protégé par votre mot de passe.</li>
<li><strong>Blocage et aide</strong> : vous pouvez bloquer un contact, et signaler un problème à l’équipe depuis l’aide intégrée.</li>
<li><strong>Suppression du compte</strong> : elle demande votre mot de passe et un code envoyé par e-mail, avec 14 jours pour annuler.</li>
</ul>
<p>Les conditions d’utilisation et la politique de confidentialité complète sont sur <a href="/docs/">/docs/</a>.</p>`,
      },
      {
        h2: 'Ce qui n’est pas encore protégé',
        html: `<p>Les messages sont chiffrés en transit, puis stockés sur le serveur : le serveur peut donc les lire. Le chiffrement de bout en bout, qui empêcherait le serveur de lire les messages, n’est pas encore implémenté. Nous ne l’annonçons pas avant sa mise en service.</p>
<p>Cette page décrit uniquement ce que l’application fait aujourd’hui, sans promesse sur ce qui viendra ensuite.</p>`,
      },
      {
        h2: 'Vérifier un fichier avant de l’installer',
        html: `<p>Les sommes de contrôle SHA-256 publiées avec les téléchargements permettent de vérifier que le fichier reçu est exactement celui qui a été publié. L’installateur Windows n’est pas signé : SmartScreen peut donc afficher un avertissement, et il faut choisir « Plus d’infos » puis « Exécuter quand même » après avoir vérifié le fichier. Le <a href="/guides/chatgram-windows-download-smartscreen.html">guide Windows</a> détaille la procédure.</p>
<p>L’APK Android s’installe à la main : autorisez « Installer des applications inconnues » pour le navigateur ou le gestionnaire de fichiers, puis installez le fichier téléchargé sur <a href="/downloads/chatgram-android.apk">/downloads/chatgram-android.apk</a>. Le <a href="/guides/chatgram-android-download-install.html">guide Android</a> reprend chaque étape.</p>`,
      },
      {
        h2: 'Un mot de passe solide et un accès maîtrisé',
        html: `<p>Choisissez un mot de passe long et unique, que vous n’utilisez pas sur un autre service. Ne partagez pas votre code de connexion, et vérifiez l’adresse du site avant de saisir vos identifiants : l’application web officielle s’ouvre sur <a href="/web/">/web/</a>.</p>
<p>La suppression du compte est volontairement protégée par deux facteurs : votre mot de passe et un code envoyé par e-mail. La période de 14 jours laisse le temps d’annuler une demande faite par erreur.</p>`,
      },
      {
        h2: 'Signaler un abus ou un problème',
        html: `<p>Vous pouvez bloquer un contact depuis sa fiche ou depuis la discussion. Pour un contenu ou un comportement problématique, utilisez le signalement : les signalements d’aide peuvent créer un ticket de suivi pour l’équipe, afin que le problème soit examiné.</p>
<p>Si votre question concerne les règles du service ou les données personnelles, consultez <a href="/docs/">/docs/</a> avant de nous écrire.</p>`,
      },
    ],
    faq: [
      {
        q: 'Mes messages sont-ils chiffrés de bout en bout ?',
        a: 'Pas encore. Les messages sont chiffrés en transit (HTTPS et WSS) et stockés sur le serveur, qui peut donc les lire. Le chiffrement de bout en bout n’est pas encore implémenté, et nous ne le présentons pas comme disponible.',
      },
      {
        q: 'Le serveur peut-il lire mes messages ?',
        a: 'Oui, pour les messages stockés : ils sont chiffrés en transit puis enregistrés sur le serveur, qui peut les lire. C’est précisément la limite que le chiffrement de bout en bout supprimerait ; il n’est pas encore en place.',
      },
      {
        q: 'Comment vérifier qu’un fichier est bien authentique ?',
        a: 'Comparez la somme de contrôle SHA-256 publiée avec le téléchargement à celle de votre fichier. Pour Windows, suivez ensuite le guide SmartScreen ; pour Android, vérifiez que vous avez téléchargé le fichier depuis /downloads/chatgram-android.apk avant de l’installer.',
      },
      {
        q: 'Que se passe-t-il quand je supprime mon compte ?',
        a: 'La suppression demande votre mot de passe et un code envoyé par e-mail. Une période de 14 jours vous permet d’annuler la demande avant que le compte soit supprimé. Les détails figurent sur la page /docs/.',
      },
    ],
  },
};

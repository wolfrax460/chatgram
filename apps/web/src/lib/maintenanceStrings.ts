/**
 * Maintenance-page copy in the four languages Chatgram AI already answers in
 * (English, Kinyarwanda, French, Swahili).
 *
 * The RW/FR/SW strings are a first pass written by a non-native speaker of two
 * of them — they are explicitly marked for native-speaker review in the UI
 * (see `nativeReview`) and in docs/reports/maintenance-page.md. Everything the
 * server itself sends (`maintenanceMessage`) is shown untranslated.
 */
import type { Locale } from './i18n';

/**
 * Repo-wide placeholder address (already used by the auth footer and /docs).
 * The admin Settings `supportEmail` field is not exposed by any public
 * endpoint, so the maintenance page cannot read the real address yet.
 */
export const MAINTENANCE_SUPPORT_EMAIL = 'support@chatgram.local';

export type MaintenanceStrings = {
  pageTitle: string;
  headline: string;
  message: string;
  statusChecking: string;
  statusDown: string;
  statusTired: string;
  statusUp: string;
  statusPreview: string;
  backHeadline: string;
  backMessage: string;
  reloadPending: string;
  tiredHeadline: string;
  tiredMessage: string;
  checkAgain: string;
  checking: string;
  detailsShow: string;
  detailsHide: string;
  currentCheck: string;
  lastChecked: string;
  neverChecked: string;
  healthUnavailable: string;
  checkResultUp: string;
  checkResultDown: string;
  labelDatabase: string;
  labelSocket: string;
  labelStorage: string;
  labelMaintenanceFlag: string;
  on: string;
  off: string;
  unknown: string;
  startedAt: string;
  endsAt: string;
  backIn: string;
  backSoon: string;
  backAnyMoment: string;
  phaseLabel: string;
  customMessageLabel: string;
  updatesTitle: string;
  updatesEmpty: string;
  updateOpened: string;
  updateCheckDown: string;
  updateCheckUp: string;
  updatesNote: string;
  quickLinksTitle: string;
  linkHelp: string;
  linkDownloads: string;
  linkPrivacy: string;
  linkContact: string;
  linkLanding: string;
  tipsTitle: string;
  tips: [string, string, string, string];
  draftTitle: string;
  draftPlaceholder: string;
  draftSaved: string;
  draftNote: string;
  notifyTitle: string;
  notifyButton: string;
  notifyOn: string;
  notifyDenied: string;
  notifyUnsupported: string;
  notifyNote: string;
  preferencesTitle: string;
  languageLabel: string;
  themeLabel: string;
  themeLight: string;
  themeDark: string;
  themeSystem: string;
  reportProblem: string;
  reportProblemSubject: string;
  reportProblemBody: string;
  nativeReview: string;
  previewBadge: string;
  previewNote: string;
  previewCheckDisabled: string;
  footerNote: string;
};

const en: MaintenanceStrings = {
  pageTitle: 'Chatgram — maintenance',
  headline: "We're making Chatgram better",
  message:
    'Chatgram is briefly offline for maintenance. Your chats are safe and will be here when we’re back.',
  statusChecking: 'Checking whether we’re back…',
  statusDown: 'Still working on it. We check again automatically.',
  statusTired: 'Still working on it. Check again when you’re ready.',
  statusUp: 'We’re back.',
  statusPreview: 'Preview only — this is how the page looks during maintenance.',
  backHeadline: 'We’re back',
  backMessage: 'Thanks for waiting. Taking you back to Chatgram…',
  reloadPending: 'Reloading in a moment…',
  tiredHeadline: 'Still working on it',
  tiredMessage:
    'Maintenance is taking longer than expected. We stopped reloading automatically — check again whenever you like.',
  checkAgain: 'Check again',
  checking: 'Checking…',
  detailsShow: 'Details',
  detailsHide: 'Hide details',
  currentCheck: 'Current check result',
  lastChecked: 'Last checked',
  neverChecked: 'No check has finished yet.',
  healthUnavailable: 'The last check did not return a health result.',
  checkResultUp: 'Server reachable',
  checkResultDown: 'Server not available',
  labelDatabase: 'Database',
  labelSocket: 'Realtime connection',
  labelStorage: 'Media storage',
  labelMaintenanceFlag: 'Maintenance mode',
  on: 'on',
  off: 'off',
  unknown: 'unknown',
  startedAt: 'Started {time}',
  endsAt: 'Expected to finish {time}',
  backIn: 'Back in about {minutes} minutes',
  backSoon: 'We’ll be back shortly.',
  backAnyMoment: 'Any moment now.',
  phaseLabel: 'Updating: {phase}',
  customMessageLabel: 'A note from the Chatgram team',
  updatesTitle: 'Live updates',
  updatesEmpty: 'The live check log appears here while we work.',
  updateOpened: 'You opened this page. Maintenance is still in progress.',
  updateCheckDown: 'Check: the server is still unavailable.',
  updateCheckUp: 'Check: the server answered.',
  updatesNote:
    'This feed is built from live checks in your browser. The dashboard has no maintenance-update endpoint yet, so admins cannot post updates here.',
  quickLinksTitle: 'While you wait',
  linkHelp: 'Help & FAQ',
  linkDownloads: 'Downloads',
  linkPrivacy: 'Privacy',
  linkContact: 'Contact us',
  linkLanding: 'Chatgram home',
  tipsTitle: 'Did you know?',
  tips: [
    'Chatgram AI can answer in English, Kinyarwanda, French and Swahili.',
    'Status lets you share a photo, video or voice note — and it disappears after 24 hours.',
    'Turn on two-step verification in Settings to protect your account with an authenticator app.',
    'Groups support voice and video calls: up to 6 on video, 12 audio-only.',
  ],
  draftTitle: 'Write something for later',
  draftPlaceholder: 'Type a message you want to send once Chatgram is back…',
  draftSaved: 'Your draft is saved on this device',
  draftNote:
    'It is not sent or queued while Chatgram is offline. It stays in this browser until you clear it.',
  notifyTitle: 'Notify me when it’s back',
  notifyButton: 'Notify me when it’s back',
  notifyOn: 'We’ll notify this browser tab when Chatgram is back.',
  notifyDenied: 'Notifications are blocked for this site in your browser settings.',
  notifyUnsupported: 'This browser does not support notifications.',
  notifyNote:
    'No closed-app push and no email address needed — this only works while the tab stays open.',
  preferencesTitle: 'Preferences',
  languageLabel: 'Language',
  themeLabel: 'Theme',
  themeLight: 'Light',
  themeDark: 'Dark',
  themeSystem: 'System',
  reportProblem: 'Report a problem',
  reportProblemSubject: 'Chatgram problem report',
  reportProblemBody: 'Page: {url}\nTime: {time}\n\nWhat happened:\n',
  nativeReview:
    'RW / FR / SW wording is a first draft and needs native-speaker review.',
  previewBadge: 'PREVIEW',
  previewNote: 'Preview only — maintenance mode is NOT enabled.',
  previewCheckDisabled: 'Live checks are disabled in the preview.',
  footerNote:
    'Your chats are saved on our servers. Nothing was deleted while we work.',
};

const rw: MaintenanceStrings = {
  pageTitle: 'Chatgram — kunoza',
  headline: 'Turimo kunoza Chatgram',
  message:
    'Chatgram irahagaritswe akanya gato kubera kunoza. Ubutumwa bwawe burabitswe neza kandi buzaba buhari tugarutse.',
  statusChecking: 'Turi kugenzura niba twagarutse…',
  statusDown: 'Turacyakora kuri byo. Turagenzura bundi bushya.',
  statusTired: 'Turacyakora kuri byo. Ongera ugenzure igihe ubishakiye.',
  statusUp: 'Twagarutse.',
  statusPreview: 'Iyi ni iyerekwa gusa — uku ni ko paji imera mu gihe cyo kunoza.',
  backHeadline: 'Twagarutse',
  backMessage: 'Murakoze kwihangana. Turakugarura kuri Chatgram…',
  reloadPending: 'Turafungura urupapuro bushya…',
  tiredHeadline: 'Turacyakora kuri byo',
  tiredMessage:
    'Kunoza kumaze igihe kirekire. Twahagaritse gufungura paji mu buryo bwikora — ongera ugenzure igihe ushakiye.',
  checkAgain: 'Ongera ugenzure',
  checking: 'Turi kugenzura…',
  detailsShow: 'Ibisobanuro',
  detailsHide: 'Hisha ibisobanuro',
  currentCheck: 'Igenzura rya vuba',
  lastChecked: 'Byagenzuwe bwa nyuma',
  neverChecked: 'Nta genzura ryarangiye.',
  healthUnavailable: 'Igenzura rya nyuma ntiryatanze igisubizo.',
  checkResultUp: 'Seriveri iraboneka',
  checkResultDown: 'Seriveri ntiboneka',
  labelDatabase: 'Baza ry’amakuru',
  labelSocket: 'Ihuza ry’igihe nyacyo',
  labelStorage: 'Ububiko bw’amafoto',
  labelMaintenanceFlag: 'Kunoza',
  on: 'birakora',
  off: 'ntibikora',
  unknown: 'ntibizwi',
  startedAt: 'Byatangiye {time}',
  endsAt: 'Biteganyijwe kurangira {time}',
  backIn: 'Tuzagaruka mu minota nk’{minutes}',
  backSoon: 'Tuzagaruka vuba.',
  backAnyMoment: 'Mu kanya gato.',
  phaseLabel: 'Biri gukorwa: {phase}',
  customMessageLabel: 'Ubutumwa bw’itsinda rya Chatgram',
  updatesTitle: 'Amakuru aheruka',
  updatesEmpty: 'Urutonde rw’igenzura ruzagaragara hano.',
  updateOpened: 'Wafunguye iyi paji. Kunoza kuracyakomeza.',
  updateCheckDown: 'Igenzura: seriveri ntiboneka.',
  updateCheckUp: 'Igenzura: seriveri yasubije.',
  updatesNote:
    'Aya makuru ava mu igenzura ry’iyi mushakisha. Abayobozi ntibashobora kohereza amakuru yo kunoza ubu.',
  quickLinksTitle: 'Mu gihe utegereje',
  linkHelp: 'Ubufasha n’ibibazo',
  linkDownloads: 'Gukurura porogaramu',
  linkPrivacy: 'Ubwirinzi bwite',
  linkContact: 'Twandikire',
  linkLanding: 'Urupapuro rw’ibanze',
  tipsTitle: 'Wari uziko…',
  tips: [
    'Chatgram AI ishobora gusubiza mu Cyongereza, Ikinyarwanda, Igifaransa n’Ikiswahili.',
    'Status ikwemerera gusangiza ifoto, videwo cyangwa ijwi — hanyuma ikavaho nyuma y’amasaha 24.',
    'Fungura kwemeza mu byiciro bibiri mu Miterere kugira ngo urinde konti yawe.',
    'Amatsinda ashobora guhamagara mu ijwi no mu videwo: abantu 6 kuri videwo, 12 ku ijwi gusa.',
  ],
  draftTitle: 'Andika ubutumwa bwo kohereza nyuma',
  draftPlaceholder: 'Andika ubutumwa ushaka kohereza Chatgram izarutse…',
  draftSaved: 'Ubutumwa bwawe bwarabitswe kuri iyi mudasobwa',
  draftNote:
    'Ntibwohererezwa cyangwa ngo bubikwe ku murongo igihe Chatgram iri kuri interineti. Buguma muri iyi mushakisha kugeza ubusibye.',
  notifyTitle: 'Menyesha ngiye kugaruka',
  notifyButton: 'Menyesha ngarutse',
  notifyOn: 'Tuzakumenyesha muri iyi fenêtre igihe Chatgram yagarutse.',
  notifyDenied: 'Imenyesha yanzwe muri iyi mushakisha.',
  notifyUnsupported: 'Iyi mushakisha ntishyigikira imenyesha.',
  notifyNote: 'Nta push yo mu telefoni ipfunywe, nta imeyili isabwa.',
  preferencesTitle: 'Ibyatoranyijwe',
  languageLabel: 'Ururimi',
  themeLabel: 'Insanganyamatsiko',
  themeLight: 'Umucyo',
  themeDark: 'Umwijima',
  themeSystem: 'Sisitemu',
  reportProblem: 'Tanga ikibazo',
  reportProblemSubject: 'Ikibazo kuri Chatgram',
  reportProblemBody: 'Paji: {url}\nIgihe: {time}\n\nIcyabaye:\n',
  nativeReview:
    'Amagambo mu Kinyarwanda, Igifaransa n’Ikiswahili ni agateganyo; bisaba gusubirwamo n’umuvuga kavukire.',
  previewBadge: 'IYEREKWA',
  previewNote: 'Iyi ni iyerekwa gusa — kunoza ntabwo kwashyizweho.',
  previewCheckDisabled: 'Igenzura rikora ntirikora mu iyerekwa.',
  footerNote:
    'Ubutumwa bwawe bubitswe kuri seriveri. Nta cyasibwe mu gihe dukora.',
};

const fr: MaintenanceStrings = {
  pageTitle: 'Chatgram — maintenance',
  headline: 'Nous améliorons Chatgram',
  message:
    'Chatgram est brièvement hors ligne pour maintenance. Vos conversations sont en sécurité et seront là à notre retour.',
  statusChecking: 'Nous vérifions si nous sommes de retour…',
  statusDown: 'Nous y travaillons encore. Nouvelle vérification automatique.',
  statusTired: 'Nous y travaillons encore. Vérifiez quand vous le souhaitez.',
  statusUp: 'Nous sommes de retour.',
  statusPreview: 'Aperçu uniquement — voici la page pendant la maintenance.',
  backHeadline: 'Nous sommes de retour',
  backMessage: 'Merci de votre patience. Retour à Chatgram…',
  reloadPending: 'Rechargement dans un instant…',
  tiredHeadline: 'Nous y travaillons encore',
  tiredMessage:
    'La maintenance prend plus de temps que prévu. Le rechargement automatique est arrêté — vérifiez quand vous le souhaitez.',
  checkAgain: 'Vérifier à nouveau',
  checking: 'Vérification…',
  detailsShow: 'Détails',
  detailsHide: 'Masquer les détails',
  currentCheck: 'Résultat de la vérification',
  lastChecked: 'Dernière vérification',
  neverChecked: 'Aucune vérification terminée.',
  healthUnavailable: 'La dernière vérification n’a pas renvoyé de résultat.',
  checkResultUp: 'Serveur accessible',
  checkResultDown: 'Serveur indisponible',
  labelDatabase: 'Base de données',
  labelSocket: 'Connexion temps réel',
  labelStorage: 'Stockage des médias',
  labelMaintenanceFlag: 'Mode maintenance',
  on: 'activé',
  off: 'désactivé',
  unknown: 'inconnu',
  startedAt: 'Débuté à {time}',
  endsAt: 'Fin prévue à {time}',
  backIn: 'De retour dans environ {minutes} minutes',
  backSoon: 'De retour très bientôt.',
  backAnyMoment: 'D’un moment à l’autre.',
  phaseLabel: 'Mise à jour : {phase}',
  customMessageLabel: 'Un mot de l’équipe Chatgram',
  updatesTitle: 'Mises à jour en direct',
  updatesEmpty: 'Le journal des vérifications apparaît ici pendant la maintenance.',
  updateOpened: 'Vous avez ouvert cette page. La maintenance continue.',
  updateCheckDown: 'Vérification : le serveur est toujours indisponible.',
  updateCheckUp: 'Vérification : le serveur a répondu.',
  updatesNote:
    'Ce fil est construit à partir des vérifications de votre navigateur. Le tableau de bord n’a pas encore d’endpoint de mises à jour de maintenance.',
  quickLinksTitle: 'En attendant',
  linkHelp: 'Aide et FAQ',
  linkDownloads: 'Téléchargements',
  linkPrivacy: 'Confidentialité',
  linkContact: 'Nous contacter',
  linkLanding: 'Accueil Chatgram',
  tipsTitle: 'Le saviez-vous ?',
  tips: [
    'Chatgram AI répond en anglais, kinyarwanda, français et kiswahili.',
    'Le Statut permet de partager une photo, une vidéo ou un message vocal — et disparaît après 24 heures.',
    'Activez la validation en deux étapes dans les Réglages pour protéger votre compte.',
    'Les groupes prennent en charge les appels vocaux et vidéo : jusqu’à 6 en vidéo, 12 en audio seul.',
  ],
  draftTitle: 'Écrire un message pour plus tard',
  draftPlaceholder: 'Saisissez un message à envoyer dès le retour de Chatgram…',
  draftSaved: 'Votre brouillon est enregistré sur cet appareil',
  draftNote:
    'Il n’est ni envoyé ni mis en file d’attente pendant la maintenance. Il reste dans ce navigateur jusqu’à ce que vous l’effaciez.',
  notifyTitle: 'Me prévenir au retour',
  notifyButton: 'Me prévenir au retour',
  notifyOn: 'Nous préviendrons cet onglet quand Chatgram sera de retour.',
  notifyDenied: 'Les notifications sont bloquées pour ce site dans votre navigateur.',
  notifyUnsupported: 'Ce navigateur ne prend pas en charge les notifications.',
  notifyNote:
    'Pas de push pour une application fermée et aucune adresse e-mail demandée — cela fonctionne seulement si l’onglet reste ouvert.',
  preferencesTitle: 'Préférences',
  languageLabel: 'Langue',
  themeLabel: 'Thème',
  themeLight: 'Clair',
  themeDark: 'Sombre',
  themeSystem: 'Système',
  reportProblem: 'Signaler un problème',
  reportProblemSubject: 'Problème Chatgram',
  reportProblemBody: 'Page : {url}\nHeure : {time}\n\nCe qui s’est passé :\n',
  nativeReview:
    'Les textes RW / FR / SW sont une première version et doivent être relus par des locuteurs natifs.',
  previewBadge: 'APERÇU',
  previewNote: 'Aperçu uniquement — le mode maintenance n’est PAS activé.',
  previewCheckDisabled: 'Les vérifications en direct sont désactivées dans l’aperçu.',
  footerNote:
    'Vos conversations sont enregistrées sur nos serveurs. Rien n’a été supprimé pendant la maintenance.',
};

const sw: MaintenanceStrings = {
  pageTitle: 'Chatgram — matengenezo',
  headline: 'Tunaboresha Chatgram',
  message:
    'Chatgram iko nje ya mtandao kwa muda mfupi kwa matengenezo. Mazungumzo yako ni salama na yatakuwa hapa tutakaporejea.',
  statusChecking: 'Tunachunguza kama tumerejea…',
  statusDown: 'Bado tunafanya kazi. Tutachunguza tena kiotomatiki.',
  statusTired: 'Bado tunafanya kazi. Chunguza tena ukipenda.',
  statusUp: 'Tumerejea.',
  statusPreview: 'Hakiki tu — hivi ndivyo ukurasa unaonekana wakati wa matengenezo.',
  backHeadline: 'Tumerejea',
  backMessage: 'Asante kwa kusubiri. Tunakurudisha kwenye Chatgram…',
  reloadPending: 'Inapakia upya hivi punde…',
  tiredHeadline: 'Bado tunafanya kazi',
  tiredMessage:
    'Matengenezo yanachukua muda mrefu kuliko ilivyotarajiwa. Tumesimamisha upakiaji wa kiotomatiki — chunguza tena ukipenda.',
  checkAgain: 'Chunguza tena',
  checking: 'Inachunguza…',
  detailsShow: 'Maelezo',
  detailsHide: 'Ficha maelezo',
  currentCheck: 'Matokeo ya ukaguzi wa sasa',
  lastChecked: 'Ukaguzi wa mwisho',
  neverChecked: 'Hakuna ukaguzi uliokamilika.',
  healthUnavailable: 'Ukaguzi wa mwisho haukutoa matokeo.',
  checkResultUp: 'Seva inapatikana',
  checkResultDown: 'Seva haipatikani',
  labelDatabase: 'Hifadhidata',
  labelSocket: 'Muunganisho wa wakati halisi',
  labelStorage: 'Hifadhi ya media',
  labelMaintenanceFlag: 'Hali ya matengenezo',
  on: 'imewashwa',
  off: 'imezimwa',
  unknown: 'haijulikani',
  startedAt: 'Ilianza {time}',
  endsAt: 'Inatarajiwa kuisha {time}',
  backIn: 'Tutarudi baada ya dakika takriban {minutes}',
  backSoon: 'Tutarudi hivi punde.',
  backAnyMoment: 'Wakati wowote sasa.',
  phaseLabel: 'Inasasishwa: {phase}',
  customMessageLabel: 'Ujumbe kutoka timu ya Chatgram',
  updatesTitle: 'Taarifa za moja kwa moja',
  updatesEmpty: 'Kumbukumbu ya ukaguzi itaonekana hapa.',
  updateOpened: 'Umefungua ukurasa huu. Matengenezo yanaendelea.',
  updateCheckDown: 'Ukaguzi: seva haipatikani bado.',
  updateCheckUp: 'Ukaguzi: seva imejibu.',
  updatesNote:
    'Taarifa hii inatokana na ukaguzi wa kivinjari chako. Dashibodi haina endpoint ya taarifa za matengenezo bado.',
  quickLinksTitle: 'Wakati unasubiri',
  linkHelp: 'Msaada na Maswali',
  linkDownloads: 'Vipakuliwa',
  linkPrivacy: 'Faragha',
  linkContact: 'Wasiliana nasi',
  linkLanding: 'Ukurasa wa nyumbani',
  tipsTitle: 'Ulijua?',
  tips: [
    'Chatgram AI inaweza kujibu kwa Kiingereza, Kinyarwanda, Kifaransa na Kiswahili.',
    'Hali (Status) hukuruhusu kushiriki picha, video au ujumbe wa sauti — na hupotea baada ya saa 24.',
    'Washa uthibitishaji wa hatua mbili kwenye Mipangilio kulinda akaunti yako.',
    'Vikundi vinaunga mkono simu za sauti na video: hadi 6 kwa video, 12 kwa sauti pekee.',
  ],
  draftTitle: 'Andika ujumbe wa baadaye',
  draftPlaceholder: 'Andika ujumbe utakaotuma Chatgram ikirejea…',
  draftSaved: 'Rasimu yako imehifadhiwa kwenye kifaa hiki',
  draftNote:
    'Haitumwa wala kuwekwa kwenye foleni wakati Chatgram iko nje ya mtandao. Inabaki kwenye kivinjari hiki hadi uifute.',
  notifyTitle: 'Nijulishe ikirejea',
  notifyButton: 'Nijulishe ikirejea',
  notifyOn: 'Tutajulisha kichupo hiki Chatgram ikirejea.',
  notifyDenied: 'Arifa zimezuiwa kwa tovuti hii kwenye kivinjari chako.',
  notifyUnsupported: 'Kivinjari hiki hakiunga mkono arifa.',
  notifyNote:
    'Hakuna push ya programu iliyofungwa na hakuna barua pepe inayohitajika — hii inafanya kazi tu ikiwa kichupo kinabaki wazi.',
  preferencesTitle: 'Mapendeleo',
  languageLabel: 'Lugha',
  themeLabel: 'Mandhari',
  themeLight: 'Nuru',
  themeDark: 'Giza',
  themeSystem: 'Mfumo',
  reportProblem: 'Ripoti tatizo',
  reportProblemSubject: 'Tatizo la Chatgram',
  reportProblemBody: 'Ukurasa: {url}\nMuda: {time}\n\nKilichotokea:\n',
  nativeReview:
    'Maneno ya RW / FR / SW ni rasimu ya kwanza na yanahitaji kupitiwa na wazawa.',
  previewBadge: 'HAKIKI',
  previewNote: 'Hakiki tu — hali ya matengenezo HAIJAWASHWA.',
  previewCheckDisabled: 'Ukaguzi wa moja kwa moja umezimwa kwenye hakiki.',
  footerNote:
    'Mazungumzo yako yamehifadhiwa kwenye seva zetu. Hakuna kilichofutwa wakati wa kazi.',
};

export const MAINTENANCE_STRINGS: Record<Locale, MaintenanceStrings> = { en, rw, fr, sw };

/** Replace `{name}` placeholders in one string. */
export function formatMaintenance(template: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    template,
  );
}

/**
 * Minimal i18n.
 *
 * The plan called for react-i18next, but that dependency is deferred, so this
 * provides the same ergonomics (`t('key')`, a language switcher, persistence)
 * in ~100 lines. Swapping to react-i18next later is mechanical: the key names
 * and dictionaries carry over unchanged.
 */
import { create } from 'zustand';

export const LOCALES = ['en', 'rw', 'fr', 'sw'] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  rw: 'Ikinyarwanda',
  fr: 'Français',
  sw: 'Kiswahili',
};

type Dict = Record<string, string>;

const en: Dict = {
  tagline: 'Connect with Everyone, Everywhere',
  signIn: 'Sign in',
  signUp: 'Create account',
  forgotTitle: 'Forgot password?',
  resetTitle: 'Reset password',
  welcomeBack: 'Welcome back',
  createYourAccount: 'Create your account',
  emailOrPhone: 'Email or phone',
  emailOrPhoneHint: 'you@example.com or +250…',
  password: 'Password',
  confirmPassword: 'Confirm password',
  fullName: 'Full name',
  showPassword: 'Show password',
  hidePassword: 'Hide password',
  capsLockOn: 'Caps Lock is on',
  keepSignedIn: 'Keep me signed in',
  forgotPassword: 'Forgot password?',
  newToChatgram: 'New to Chatgram?',
  alreadyHaveAccount: 'Already have an account?',
  createAccountLink: 'Create account',
  backToSignIn: 'Back to sign in',
  agreeTerms: 'I agree to the Terms and Privacy Policy',
  sendCode: 'Send code',
  resendCode: 'Resend code',
  resetPassword: 'Set new password',
  verificationCode: 'Verification code',
  newPassword: 'New password',
  privacy: 'Privacy Policy',
  terms: 'Terms',
  help: 'Help & Support',
  version: 'Version',
  downloadWindows: 'Download for Windows',
  downloadAndroid: 'Download for Android',
  language: 'Language',
  wakingUp: 'Waking up the server, this can take a few seconds…',
  countryCode: 'Country code',
  strengthWeak: 'Weak',
  strengthFair: 'Fair',
  strengthGood: 'Good',
  strengthStrong: 'Strong',
  errRequired: 'This field is required',
  errInvalidEmail: 'Enter a valid email address',
  errInvalidPhone: 'Enter a valid phone number',
  errPasswordShort: 'Password must be at least 8 characters',
  errPasswordMismatch: 'Passwords do not match',
  errAgreeTerms: 'Please accept the Terms and Privacy Policy',
  errWrongCredentials: 'Wrong email or password',
  errNoInternet: 'No internet connection. Check your network and try again.',
  errServerUnreachable: 'Cannot reach the server. Please try again shortly.',
  errTooManyAttempts: 'Too many attempts. Try again in {seconds}s.',
  errSessionExpired: 'Your session expired. Please sign in again.',
  errGeneric: 'Something went wrong. Please try again.',
  errPhoneSignupSoon:
    'Phone sign-up is still in development. Please create your account with an email address for now — we will email you a verification code.',
  infoResetSent: 'If that account exists, a reset code is on its way.',
  infoResetDone: 'Password changed. You can sign in now.',
  infoVerify: 'Check your email or phone for the verification code.',
  infoCodeSent: 'We sent a 6-digit code to your email. Enter it below to finish.',
  infoCodeResent: 'A new code is on its way.',
  infoVerifyEmail: 'Enter the 6-digit code we emailed you to verify your address.',
  verifyAndCreate: 'Verify and create account',
  errInvalidCode: 'That code is not valid or has expired.',
};

const rw: Dict = {
  tagline: 'Huza n’abantu bose, ahantu hose',
  signIn: 'Injira',
  signUp: 'Fungura konti',
  forgotTitle: 'Wibagiwe ijambo ry’ibanga?',
  resetTitle: 'Hindura ijambo ry’ibanga',
  welcomeBack: 'Murakaza neza',
  createYourAccount: 'Fungura konti yawe',
  emailOrPhone: 'Imeyili cyangwa telefoni',
  password: 'Ijambo ry’ibanga',
  confirmPassword: 'Emeza ijambo ry’ibanga',
  fullName: 'Amazina yombi',
  showPassword: 'Erekana ijambo ry’ibanga',
  hidePassword: 'Hisha ijambo ry’ibanga',
  capsLockOn: 'Caps Lock irakora',
  keepSignedIn: 'Nkomeze nzinjye',
  forgotPassword: 'Wibagiwe ijambo ry’ibanga?',
  newToChatgram: 'Uri mushya kuri Chatgram?',
  createAccountLink: 'Fungura konti',
  backToSignIn: 'Subira ku kwinjira',
  agreeTerms: 'Nemeye amabwiriza n’ubwirinzi bwite',
  sendCode: 'Ohereza kode',
  resetPassword: 'Shyiraho ijambo ry’ibanga rishya',
  verificationCode: 'Kode yo kwemeza',
  newPassword: 'Ijambo ry’ibanga rishya',
  privacy: 'Ubwirinzi bwite',
  terms: 'Amabwiriza',
  help: 'Ubufasha',
  version: 'Verisiyo',
  language: 'Ururimi',
  wakingUp: 'Seriveri iri gukanguka, birafata akanya gato…',
  errRequired: 'Iki kibazo kirasabwa',
  errInvalidEmail: 'Shyiramo imeyili yemewe',
  errInvalidPhone: 'Shyiramo nimero ya telefoni yemewe',
  errPasswordShort: 'Ijambo ry’ibanga rigomba kuba nibura inyuguti 8',
  errPasswordMismatch: 'Amagambo y’ibanga ntabwo ahura',
  errAgreeTerms: 'Emera amabwiriza n’ubwirinzi bwite',
  errWrongCredentials: 'Imeyili cyangwa ijambo ry’ibanga sibyo',
  errNoInternet: 'Nta murandasi. Reba urusobe hanyuma ugerageze.',
  errServerUnreachable: 'Ntibishoboka kugera kuri seriveri.',
  infoResetSent: 'Niba konti ibaho, kode yoherejwe.',
  infoResetDone: 'Ijambo ry’ibanga ryahinduwe.',
};

const fr: Dict = {
  tagline: 'Connectez-vous avec tout le monde, partout',
  signIn: 'Se connecter',
  signUp: 'Créer un compte',
  forgotTitle: 'Mot de passe oublié ?',
  resetTitle: 'Réinitialiser le mot de passe',
  welcomeBack: 'Bon retour',
  createYourAccount: 'Créez votre compte',
  emailOrPhone: 'E-mail ou téléphone',
  password: 'Mot de passe',
  confirmPassword: 'Confirmer le mot de passe',
  fullName: 'Nom complet',
  showPassword: 'Afficher le mot de passe',
  hidePassword: 'Masquer le mot de passe',
  capsLockOn: 'Verr. Maj est activé',
  keepSignedIn: 'Rester connecté',
  forgotPassword: 'Mot de passe oublié ?',
  newToChatgram: 'Nouveau sur Chatgram ?',
  createAccountLink: 'Créer un compte',
  backToSignIn: 'Retour à la connexion',
  agreeTerms: 'J’accepte les Conditions et la Politique de confidentialité',
  sendCode: 'Envoyer le code',
  resetPassword: 'Définir un nouveau mot de passe',
  verificationCode: 'Code de vérification',
  newPassword: 'Nouveau mot de passe',
  privacy: 'Confidentialité',
  terms: 'Conditions',
  help: 'Aide',
  version: 'Version',
  language: 'Langue',
  wakingUp: 'Réveil du serveur, cela peut prendre quelques secondes…',
  errRequired: 'Ce champ est obligatoire',
  errInvalidEmail: 'Saisissez une adresse e-mail valide',
  errInvalidPhone: 'Saisissez un numéro de téléphone valide',
  errPasswordShort: 'Le mot de passe doit contenir au moins 8 caractères',
  errPasswordMismatch: 'Les mots de passe ne correspondent pas',
  errAgreeTerms: 'Veuillez accepter les Conditions et la Confidentialité',
  errWrongCredentials: 'E-mail ou mot de passe incorrect',
  errNoInternet: 'Pas de connexion Internet.',
  errServerUnreachable: 'Serveur inaccessible. Réessayez bientôt.',
  infoResetSent: 'Si ce compte existe, un code a été envoyé.',
  infoResetDone: 'Mot de passe modifié.',
};

const sw: Dict = {
  tagline: 'Ungana na kila mtu, kila mahali',
  signIn: 'Ingia',
  signUp: 'Fungua akaunti',
  forgotTitle: 'Umesahau neno la siri?',
  resetTitle: 'Weka upya neno la siri',
  welcomeBack: 'Karibu tena',
  createYourAccount: 'Fungua akaunti yako',
  emailOrPhone: 'Barua pepe au simu',
  password: 'Neno la siri',
  confirmPassword: 'Thibitisha neno la siri',
  fullName: 'Jina kamili',
  showPassword: 'Onyesha neno la siri',
  hidePassword: 'Ficha neno la siri',
  capsLockOn: 'Caps Lock imewaka',
  keepSignedIn: 'Nibaki nimeingia',
  forgotPassword: 'Umesahau neno la siri?',
  newToChatgram: 'Mgeni kwenye Chatgram?',
  createAccountLink: 'Fungua akaunti',
  backToSignIn: 'Rudi kuingia',
  agreeTerms: 'Nakubali Masharti na Sera ya Faragha',
  sendCode: 'Tuma msimbo',
  resetPassword: 'Weka neno la siri jipya',
  verificationCode: 'Msimbo wa uthibitisho',
  newPassword: 'Neno la siri jipya',
  privacy: 'Sera ya Faragha',
  terms: 'Masharti',
  help: 'Msaada',
  version: 'Toleo',
  language: 'Lugha',
  wakingUp: 'Seva inaamka, inaweza kuchukua sekunde chache…',
  errRequired: 'Sehemu hii inahitajika',
  errInvalidEmail: 'Weka barua pepe sahihi',
  errInvalidPhone: 'Weka namba ya simu sahihi',
  errPasswordShort: 'Neno la siri linahitaji herufi 8 au zaidi',
  errPasswordMismatch: 'Maneno ya siri hayafanani',
  errAgreeTerms: 'Tafadhali kubali Masharti na Sera ya Faragha',
  errWrongCredentials: 'Barua pepe au neno la siri si sahihi',
  errNoInternet: 'Hakuna mtandao.',
  errServerUnreachable: 'Seva haipatikani.',
  infoResetSent: 'Kama akaunti ipo, msimbo umetumwa.',
  infoResetDone: 'Neno la siri limebadilishwa.',
};

const DICTS: Record<Locale, Dict> = { en, rw, fr, sw };

const STORAGE_KEY = 'chatgram.locale';

interface I18nState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as Locale | null;
    if (saved && LOCALES.includes(saved)) return saved;
    const browser = navigator.language.slice(0, 2) as Locale;
    if (LOCALES.includes(browser)) return browser;
  } catch {
    /* ignore */
  }
  return 'en';
}

export const useI18nStore = create<I18nState>((set) => ({
  locale: typeof localStorage === 'undefined' ? 'en' : initialLocale(),
  setLocale: (locale) => {
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      /* ignore */
    }
    set({ locale });
  },
}));

export function translate(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  const raw = DICTS[locale]?.[key] ?? DICTS.en[key] ?? key;
  if (!vars) return raw;
  return Object.entries(vars).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    raw,
  );
}

/** `const { t, locale, setLocale } = useI18n()` */
export function useI18n() {
  const locale = useI18nStore((s) => s.locale);
  const setLocale = useI18nStore((s) => s.setLocale);
  return {
    locale,
    setLocale,
    t: (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars),
  };
}

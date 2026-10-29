/** Routes inside the Settings screen (mobile push nav + desktop detail pane). */
export type SettingsRoute =
  | 'list'
  | 'profile'
  | 'account'
  | 'delete-account'
  | 'privacy'
  | 'chats'
  | 'notifications'
  | 'storage'
  | 'ai'
  | 'help'
  | 'invite';

/** Props every settings sub-page receives. */
export interface SettingsPageProps {
  /** Mobile back button (desktop keeps the list visible, so this is a no-op there). */
  onBack: () => void;
  navigate: (route: SettingsRoute) => void;
}

export type SettingsNoticeTone = 'info' | 'success' | 'error' | 'warning';

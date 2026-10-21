import { createContext, useContext } from 'react';

/**
 * Global profile-panel controller.
 *
 * Any component (chat header, chat list, group members, contacts, status
 * viewer, message bubble) can call `openProfile(userId)` and a single panel is
 * rendered by the app shell.
 */
export interface ProfilePanelApi {
  openProfile: (userId: string, chatId?: string) => void;
  closeProfile: () => void;
  /** The user id currently shown, or null. */
  activeUserId: string | null;
}

const noop: ProfilePanelApi = {
  openProfile: () => undefined,
  closeProfile: () => undefined,
  activeUserId: null,
};

export const ProfilePanelContext = createContext<ProfilePanelApi>(noop);

export function useProfilePanel(): ProfilePanelApi {
  return useContext(ProfilePanelContext);
}

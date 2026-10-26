import { createContext, useContext } from 'react';

/**
 * Global GROUP INFO controller.
 *
 * A group is identified by its chat id. The shell renders one GroupInfo panel
 * for whichever group is active, so the chat header, the Groups tab and the
 * chat list all open exactly the same panel.
 */
export interface GroupInfoApi {
  openGroupInfo: (chatId: string) => void;
  closeGroupInfo: () => void;
  activeGroupId: string | null;
}

const noop: GroupInfoApi = {
  openGroupInfo: () => undefined,
  closeGroupInfo: () => undefined,
  activeGroupId: null,
};

export const GroupInfoContext = createContext<GroupInfoApi>(noop);

export function useGroupInfo(): GroupInfoApi {
  return useContext(GroupInfoContext);
}

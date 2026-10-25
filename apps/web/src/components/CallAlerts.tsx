import { useEffect, useSyncExternalStore } from 'react';
import { useSession } from '@chatgram/core';
import {
  getCallState,
  handlePageHide,
  rejectCall,
  setCallUserId,
  subscribeCalls,
} from '../lib/calls';
import {
  clearNotification,
  ensureNotificationPermission,
  setCallTitle,
  showIncomingNotification,
  startRingtone,
  stopRingtone,
} from '../lib/callAlerts';

/**
 * Drives everything around a call that is not the call itself: ringtone,
 * notification when the tab is in the background, tab title, and teardown when
 * the page is closed or reloaded.
 */
export function CallAlerts() {
  const call = useSyncExternalStore(subscribeCalls, getCallState);
  const user = useSession((s) => s.user);
  const userId = user?.id;

  useEffect(() => {
    if (userId) setCallUserId(userId);
  }, [userId]);

  // Closing or reloading the tab must not leak the call or the camera.
  useEffect(() => {
    const bye = () => handlePageHide();
    window.addEventListener('pagehide', bye);
    window.addEventListener('beforeunload', bye);
    return () => {
      window.removeEventListener('pagehide', bye);
      window.removeEventListener('beforeunload', bye);
    };
  }, []);

  // The desktop shell uses this for the tray alert / taskbar flash.
  useEffect(() => {
    const desktop = (window as unknown as { chatgramDesktop?: { callState?: (payload: { state: string; title: string }) => void } }).chatgramDesktop;
    desktop?.callState?.({ state: call.status, title: call.title });
  }, [call.status, call.title]);

  useEffect(() => {
    if (call.status === 'incoming') {
      startRingtone();
      setCallTitle(`Incoming call — ${call.title}`);

      const maybeNotify = () => {
        if (!document.hidden) return;
        void ensureNotificationPermission().then((granted) => {
          if (!granted) return;
          showIncomingNotification({
            title: `Incoming ${call.video ? 'video ' : ''}call`,
            body: `${call.title} is calling`,
            onOpen: () => {
              window.focus();
              clearNotification();
            },
            onDecline: () => rejectCall(),
          });
        });
      };
      maybeNotify();
      document.addEventListener('visibilitychange', maybeNotify);
      return () => document.removeEventListener('visibilitychange', maybeNotify);
    }

    stopRingtone();
    clearNotification();
    if (call.status === 'calling') setCallTitle(`Calling ${call.title}…`);
    else if (call.status === 'active') setCallTitle(`In a call with ${call.title}`);
    else if (call.status === 'reconnecting') setCallTitle(`Reconnecting — ${call.title}`);
    else if (call.status === 'connecting') setCallTitle(`Connecting — ${call.title}`);
    else setCallTitle(null);
    return undefined;
  }, [call.status, call.title, call.video]);

  // Answering from the notification would need a user gesture; the click focuses
  // the tab and the overlay's Answer button (above) does the accepting.
  useEffect(() => {
    if (call.status === 'idle' || call.status === 'ended') stopRingtone();
  }, [call.status]);

  return null;
}


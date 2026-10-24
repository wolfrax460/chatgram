import { useEffect, useRef } from 'react';
import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff, X } from 'lucide-react';
import {
  acceptCall,
  dismissCall,
  getLocalStream,
  getRemoteStream,
  hangUp,
  rejectCall,
  toggleCamera,
  toggleMute,
  type CallState,
} from '../lib/calls';

/**
 * Full-screen call overlay: outgoing ring, incoming call, active call with mute /
 * camera / hang-up. Remote audio is played through a hidden <audio>; video calls
 * show both feeds.
 */
export function CallOverlay({ call }: { call: CallState }) {
  const remoteVideo = useRef<HTMLVideoElement>(null);
  const remoteAudio = useRef<HTMLAudioElement>(null);
  const localVideo = useRef<HTMLVideoElement>(null);

  const active = call.status === 'active' || call.status === 'connecting';
  const video = call.video && active;

  useEffect(() => {
    if (remoteVideo.current) remoteVideo.current.srcObject = getRemoteStream();
    if (remoteAudio.current) {
      remoteAudio.current.srcObject = getRemoteStream();
      void remoteAudio.current.play().catch(() => {});
    }
    if (localVideo.current) localVideo.current.srcObject = getLocalStream();
  });

  if (call.status === 'idle') return null;

  const peerName = call.peer?.displayName ?? 'Chatgram user';
  const label =
    call.status === 'calling'
      ? `Calling ${peerName}…`
      : call.status === 'incoming'
        ? `${peerName} is calling`
        : call.status === 'connecting'
          ? 'Connecting…'
          : call.status === 'active'
            ? peerName
            : call.message ?? 'Call ended';

  const elapsed = call.startedAt ? Math.max(0, Math.floor((Date.now() - call.startedAt) / 1000)) : 0;
  const clock = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;

  return (
    <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-ink-900/95 text-white" role="dialog" aria-label="Call">
      <audio ref={remoteAudio} autoPlay className="hidden" />
      {video ? (
        <video ref={remoteVideo} autoPlay playsInline className="absolute inset-0 h-full w-full object-cover opacity-80" />
      ) : null}

      <div className="relative z-10 flex flex-col items-center gap-3 p-6 text-center">
        <div className="grid h-24 w-24 place-items-center overflow-hidden rounded-full bg-brand-600 text-3xl font-bold">
          {call.peer?.avatarUrl ? (
            <img src={call.peer.avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            peerName.slice(0, 2).toUpperCase()
          )}
        </div>
        <h2 className="text-xl font-bold" data-testid="call-title">{label}</h2>
        {call.status === 'active' ? <p className="font-mono text-sm opacity-80" data-testid="call-timer">{clock}</p> : null}
        {call.status === 'ended' || call.status === 'error' ? (
          <p className="max-w-xs text-sm opacity-80" data-testid="call-message">{call.message}</p>
        ) : null}

        {video ? (
          <video ref={localVideo} autoPlay muted playsInline className="mt-2 h-40 w-28 rounded-xl border border-white/20 object-cover" />
        ) : null}

        <div className="mt-6 flex items-center gap-3">
          {call.status === 'incoming' ? (
            <>
              <button
                type="button"
                onClick={() => void acceptCall()}
                className="grid h-14 w-14 place-items-center rounded-full bg-emerald-500 hover:bg-emerald-600"
                aria-label="Accept call"
              >
                <Phone className="h-6 w-6" />
              </button>
              <button
                type="button"
                onClick={rejectCall}
                className="grid h-14 w-14 place-items-center rounded-full bg-rose-600 hover:bg-rose-700"
                aria-label="Decline call"
              >
                <PhoneOff className="h-6 w-6" />
              </button>
            </>
          ) : call.status === 'calling' || call.status === 'connecting' || call.status === 'active' ? (
            <>
              {active ? (
                <button
                  type="button"
                  onClick={toggleMute}
                  className={`grid h-12 w-12 place-items-center rounded-full ${call.muted ? 'bg-white text-ink-900' : 'bg-white/15 hover:bg-white/25'}`}
                  aria-label={call.muted ? 'Unmute' : 'Mute'}
                >
                  {call.muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                </button>
              ) : null}
              {active && call.video ? (
                <button
                  type="button"
                  onClick={toggleCamera}
                  className={`grid h-12 w-12 place-items-center rounded-full ${call.cameraOn ? 'bg-white/15 hover:bg-white/25' : 'bg-white text-ink-900'}`}
                  aria-label={call.cameraOn ? 'Turn camera off' : 'Turn camera on'}
                >
                  {call.cameraOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
                </button>
              ) : null}
              <button
                type="button"
                onClick={hangUp}
                className="grid h-14 w-14 place-items-center rounded-full bg-rose-600 hover:bg-rose-700"
                aria-label="Hang up"
              >
                <PhoneOff className="h-6 w-6" />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={dismissCall}
              className="mt-2 inline-flex items-center gap-2 rounded-full bg-white/15 px-5 py-2.5 text-sm font-semibold hover:bg-white/25"
            >
              <X className="h-4 w-4" /> Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

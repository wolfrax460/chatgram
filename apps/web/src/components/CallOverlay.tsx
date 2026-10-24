import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff, X, Users } from 'lucide-react';
import {
  MAX_CALL_PARTICIPANTS,
  acceptCall,
  dismissCall,
  getLocalStream,
  getPeerStream,
  hangUp,
  rejectCall,
  toggleCamera,
  toggleMute,
  type CallParticipant,
  type CallState,
} from '../lib/calls';

function initials(name?: string): string {
  const clean = (name || '?').trim();
  const parts = clean.split(/\s+/);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}

/** One remote participant: video (which also carries audio) or an audio-only tile. */
function PeerTile({
  participant,
  video,
  streamTick,
  large,
}: {
  participant: CallParticipant;
  video: boolean;
  streamTick: number;
  large: boolean;
}) {
  const media = useRef<HTMLVideoElement>(null);
  const stream = getPeerStream(participant.id);

  useEffect(() => {
    if (media.current && stream) {
      media.current.srcObject = stream;
      void media.current.play().catch(() => {});
    }
  }, [stream, streamTick]);

  if (video) {
    return (
      <div className="relative overflow-hidden rounded-2xl bg-ink-800">
        <video
          ref={media}
          autoPlay
          playsInline
          className="h-full w-full object-cover"
          aria-label={`${participant.displayName ?? 'Participant'} video`}
        />
        <span className="absolute bottom-2 left-2 rounded-md bg-black/50 px-2 py-0.5 text-xs font-medium">
          {participant.displayName ?? 'Chatgram user'}
        </span>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl bg-white/10">
      <audio ref={media} autoPlay />
      <div
        className={`grid place-items-center rounded-full bg-brand-600 font-bold ${
          large ? 'h-24 w-24 text-2xl' : 'h-14 w-14 text-base'
        }`}
      >
        {initials(participant.displayName)}
      </div>
      <span className={large ? 'text-base font-semibold' : 'text-xs font-medium opacity-90'}>
        {participant.displayName ?? 'Chatgram user'}
      </span>
    </div>
  );
}

function gridFor(count: number): string {
  if (count <= 1) return 'grid-cols-1';
  if (count === 2) return 'grid-cols-2';
  if (count <= 4) return 'grid-cols-2';
  if (count <= 9) return 'grid-cols-3';
  return 'grid-cols-4';
}

/**
 * Full-screen call UI.
 *
 * 1:1 calls show one large tile (video or avatar). Group calls show a grid of
 * every participant, with the local preview pinned in the corner.
 */
export function CallOverlay({ call }: { call: CallState }) {
  const localVideo = useRef<HTMLVideoElement>(null);
  const [, forceTick] = useState(0);

  // Re-render once a second so the call timer advances.
  useEffect(() => {
    if (call.status !== 'active') return undefined;
    const id = window.setInterval(() => forceTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [call.status]);

  useEffect(() => {
    if (localVideo.current && call.video && call.cameraOn) {
      localVideo.current.srcObject = getLocalStream();
    }
  }, [call.video, call.cameraOn, call.streamTick]);

  if (call.status === 'idle') return null;

  const active = call.status === 'active' || call.status === 'connecting';
  const inCall = call.status === 'calling' || call.status === 'connecting' || call.status === 'active';
  const remoteCount = call.participants.length;
  const showVideo = call.video && active;
  const large = remoteCount === 1;

  const label =
    call.status === 'calling'
      ? call.isGroup
        ? `Calling ${call.title}…`
        : `Calling ${call.title}…`
      : call.status === 'incoming'
        ? `${call.title} is calling`
        : call.status === 'connecting'
          ? 'Connecting…'
          : call.status === 'active'
            ? call.title
            : call.message ?? 'Call ended';

  const elapsed = call.startedAt ? Math.max(0, Math.floor((Date.now() - call.startedAt) / 1000)) : 0;
  const clock = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col bg-ink-900/97 text-white"
      role="dialog"
      aria-label={call.isGroup ? 'Group call' : 'Call'}
    >
      {/* header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-bold" data-testid="call-title">
            {label}
          </h2>
          <p className="text-xs text-white/70" data-testid="call-subtitle">
            {call.isGroup ? (
              <>
                <Users className="mr-1 inline h-3.5 w-3.5" />
                {remoteCount + (active || call.status === 'calling' ? 1 : 0)} / {MAX_CALL_PARTICIPANTS} people
                {call.video ? ' · video' : ' · voice'}
              </>
            ) : call.status === 'active' ? (
              'connected'
            ) : (
              'connecting…'
            )}
            {call.status === 'active' ? <span className="ml-2 font-mono" data-testid="call-timer">{clock}</span> : null}
          </p>
        </div>
      </div>

      {/* participants */}
      <div className="relative flex-1 overflow-y-auto px-3 pb-3">
        {remoteCount === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <div className="grid h-20 w-20 place-items-center rounded-full bg-brand-600 text-2xl font-bold">
              {initials(call.title)}
            </div>
            <p className="text-sm text-white/70">
              {call.status === 'incoming' ? 'Incoming call' : 'Waiting for someone to join…'}
            </p>
          </div>
        ) : (
          <div className={`grid h-full gap-2 ${gridFor(remoteCount)} ${large ? 'grid-rows-1' : 'auto-rows-fr'}`}>
            {call.participants.map((participant) => (
              <PeerTile
                key={participant.id}
                participant={participant}
                video={showVideo}
                streamTick={call.streamTick}
                large={large}
              />
            ))}
          </div>
        )}

        {/* local preview */}
        {showVideo ? (
          <video
            ref={localVideo}
            autoPlay
            muted
            playsInline
            className={
              large
                ? 'mt-2 h-40 w-28 rounded-xl border border-white/20 object-cover'
                : 'absolute bottom-3 right-3 h-28 w-20 rounded-xl border border-white/20 object-cover shadow-lg'
            }
            aria-label="Your camera"
          />
        ) : null}
      </div>

      {/* notices */}
      {call.notice ? (
        <p className="px-4 pb-1 text-center text-xs text-white/70" data-testid="call-notice">
          {call.notice}
        </p>
      ) : null}
      {(call.status === 'ended' || call.status === 'error') && call.message ? (
        <p className="px-4 pb-1 text-center text-sm text-white/80" data-testid="call-message">
          {call.message}
        </p>
      ) : null}

      {/* controls */}
      <div className="flex items-center justify-center gap-3 px-4 pb-8 pt-2">
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
        ) : inCall ? (
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
            className="inline-flex items-center gap-2 rounded-full bg-white/15 px-5 py-2.5 text-sm font-semibold hover:bg-white/25"
          >
            <X className="h-4 w-4" /> Close
          </button>
        )}
      </div>
    </div>
  );
}

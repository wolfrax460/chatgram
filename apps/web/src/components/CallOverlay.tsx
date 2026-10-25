import { useEffect, useRef, useState } from 'react';
import {
  Mic, MicOff, Phone, PhoneOff, Video, VideoOff, X, Users, Minimize2, Maximize2,
  Settings2, Volume2, Signal, SignalLow, SignalMedium,
} from 'lucide-react';
import {
  MAX_AUDIO_PARTICIPANTS,
  MAX_VIDEO_PARTICIPANTS,
  acceptCall,
  dismissCall,
  getLocalStream,
  getPeerStream,
  hangUp,
  rejectCall,
  setMinimised,
  setSpeaker,
  supportsSpeakerSelection,
  switchDevice,
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

function clockFor(startedAt: number | null): string {
  const elapsed = startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0;
  const hours = Math.floor(elapsed / 3600);
  const minutes = Math.floor((elapsed % 3600) / 60);
  const seconds = elapsed % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

function qualityLabel(quality: CallState['quality']): { label: string; Icon: typeof Signal } {
  if (quality === 'good') return { label: 'Good connection', Icon: Signal };
  if (quality === 'fair') return { label: 'Fair connection', Icon: SignalMedium };
  if (quality === 'poor') return { label: 'Poor connection', Icon: SignalLow };
  return { label: '', Icon: Signal };
}

/** One remote participant. Video tiles carry audio; audio-only tiles use <audio>. */
function PeerTile({
  participant,
  showVideo,
  large,
  audioSinkId,
}: {
  participant: CallParticipant;
  showVideo: boolean;
  large: boolean;
  audioSinkId: string;
}) {
  const media = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const stream = getPeerStream(participant.id);

  // No dependency array on purpose: a MediaStream mutates in place as tracks
  // arrive and React can recreate the element; re-attaching is cheap and safe.
  useEffect(() => {
    const element: HTMLMediaElement | null = media.current ?? audio.current;
    if (element && stream && element.srcObject !== stream) element.srcObject = stream;
    if (element) void element.play().catch(() => undefined);
    if (element && audioSinkId) {
      const withSink = element as HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> };
      if (withSink.setSinkId) void withSink.setSinkId(audioSinkId).catch(() => undefined);
    }
  });

  if (showVideo && !participant.audioOnly) {
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
      <audio ref={audio} autoPlay data-call-audio={participant.id} />
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
      {participant.audioOnly ? <span className="text-[10px] uppercase tracking-wide opacity-60">audio only</span> : null}
    </div>
  );
}

function gridFor(count: number): string {
  if (count <= 1) return 'grid-cols-1';
  if (count <= 4) return 'grid-cols-2';
  if (count <= 9) return 'grid-cols-3';
  return 'grid-cols-4';
}

/**
 * Call UI.
 *
 * Full screen while the call is the focus; a small floating bar when minimised
 * so the user can keep browsing chats. Shows reconnect state, connection
 * quality, participant caps and device pickers.
 */
export function CallOverlay({ call }: { call: CallState }) {
  const localVideo = useRef<HTMLVideoElement>(null);
  const [, forceTick] = useState(0);
  const [menu, setMenu] = useState<null | 'devices'>(null);

  useEffect(() => {
    if (call.status !== 'active' && call.status !== 'reconnecting') return undefined;
    const id = window.setInterval(() => forceTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [call.status]);

  useEffect(() => {
    const stream = getLocalStream();
    if (localVideo.current && call.video && call.cameraOn && stream && localVideo.current.srcObject !== stream) {
      localVideo.current.srcObject = stream;
    }
  });

  if (call.status === 'idle') return null;

  const active = call.status === 'active' || call.status === 'reconnecting';
  const inCall = call.status === 'calling' || call.status === 'connecting' || call.status === 'reconnecting' || call.status === 'active';
  const remoteCount = call.participants.length;
  const showVideo = call.video && !call.audioOnly;
  const large = remoteCount === 1;
  const cap = call.video ? MAX_VIDEO_PARTICIPANTS : MAX_AUDIO_PARTICIPANTS;

  // Minimised bar: keep the call reachable while browsing other chats.
  if (call.minimised && inCall) {
    return (
      <div
        className="fixed bottom-4 left-1/2 z-[70] flex w-[min(92vw,420px)] -translate-x-1/2 items-center gap-3 rounded-2xl bg-ink-900 px-3 py-2.5 text-white shadow-2xl"
        role="status"
        aria-label="Call in progress"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-bold">
          {initials(call.title)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold" data-testid="minimised-call-title">{call.title}</p>
          <p className="text-[11px] text-white/70">
            {call.status === 'reconnecting' ? 'Reconnecting…' : clockFor(call.startedAt)}
            {call.video ? ' · video' : ' · voice'}
          </p>
        </div>
        <button type="button" className="rounded-full bg-white/10 p-2 hover:bg-white/20" aria-label="Mute" onClick={() => void toggleMute()}>
          {call.muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </button>
        <button type="button" className="rounded-full bg-white/10 p-2 hover:bg-white/20" aria-label="Return to call" onClick={() => setMinimised(false)}>
          <Maximize2 className="h-4 w-4" />
        </button>
        <button type="button" className="rounded-full bg-rose-600 p-2 hover:bg-rose-700" aria-label="Hang up" onClick={hangUp}>
          <PhoneOff className="h-4 w-4" />
        </button>
      </div>
    );
  }

  const label =
    call.status === 'calling'
      ? `Calling ${call.title}…`
      : call.status === 'incoming'
        ? `${call.title} is calling`
        : call.status === 'connecting'
          ? 'Connecting…'
          : call.status === 'reconnecting'
            ? 'Reconnecting…'
            : call.status === 'active'
              ? call.title
              : call.message ?? 'Call ended';

  const quality = qualityLabel(call.quality);

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col bg-ink-900/95 text-white backdrop-blur-sm"
      role="dialog"
      aria-label={call.isGroup ? 'Group call' : 'Call'}
      data-testid="call-overlay"
    >
      {/* header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-bold" data-testid="call-title">{label}</h2>
          <p className="text-xs text-white/70" data-testid="call-subtitle">
            {call.isGroup ? (
              <>
                <Users className="mr-1 inline h-3.5 w-3.5" />
                {remoteCount + (inCall ? 1 : 0)} / {cap} people
                {call.video ? ' · video' : ' · voice'}
              </>
            ) : call.status === 'active' ? (
              'connected'
            ) : (
              'connecting…'
            )}
            {active ? <span className="ml-2 font-mono" data-testid="call-timer">{clockFor(call.startedAt)}</span> : null}
            {quality.label ? (
              <span className="ml-2 inline-flex items-center gap-1" data-testid="call-quality" title={quality.label}>
                <quality.Icon className="h-3.5 w-3.5" />
                {quality.label}
              </span>
            ) : null}
          </p>
        </div>
        {inCall ? (
          <button
            type="button"
            className="rounded-full bg-white/10 p-2 hover:bg-white/20"
            aria-label="Minimise call"
            title="Minimise"
            onClick={() => setMinimised(true)}
          >
            <Minimize2 className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {call.status === 'reconnecting' ? (
        <p className="mx-4 mb-2 rounded-lg bg-amber-500/15 px-3 py-2 text-center text-xs font-medium text-amber-200" data-testid="call-reconnecting">
          Reconnecting… the call will end if the connection does not come back.
        </p>
      ) : null}

      {/* participants */}
      <div className="relative min-h-0 flex-1 px-3 pb-3">
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
                showVideo={showVideo}
                large={large}
                audioSinkId={call.sinkId}
              />
            ))}
          </div>
        )}

        {showVideo ? (
          <video
            ref={localVideo}
            autoPlay
            muted
            playsInline
            className={`absolute bottom-4 right-4 rounded-xl border border-white/20 object-cover shadow-lg ${large ? 'h-40 w-28' : 'h-28 w-20'}`}
            aria-label="Your camera"
          />
        ) : null}
      </div>

      {call.notice ? (
        <p className="px-4 pb-1 text-center text-xs text-white/70" data-testid="call-notice">{call.notice}</p>
      ) : null}
      {(call.status === 'ended' || call.status === 'error') && call.message ? (
        <p className="px-4 pb-1 text-center text-sm text-white/80" data-testid="call-message">{call.message}</p>
      ) : null}

      {/* device menu */}
      {menu === 'devices' && inCall ? (
        <div className="mx-4 mb-2 rounded-xl bg-white/10 p-3 text-xs" data-testid="call-devices">
          <label className="mb-2 block">
            <span className="mb-1 block font-semibold opacity-80">Microphone</span>
            <select
              className="w-full rounded-lg bg-ink-800 px-2 py-1.5"
              value=""
              onChange={(event) => { if (event.target.value) void switchDevice('audio', event.target.value); }}
            >
              <option value="">{call.muted ? 'Muted' : 'Default microphone'}</option>
              {call.devices.audioInput.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
            </select>
          </label>
          {call.video ? (
            <label className="mb-2 block">
              <span className="mb-1 block font-semibold opacity-80">Camera</span>
              <select
                className="w-full rounded-lg bg-ink-800 px-2 py-1.5"
                value=""
                onChange={(event) => { if (event.target.value) void switchDevice('video', event.target.value); }}
              >
                <option value="">Default camera</option>
                {call.devices.videoInput.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
              </select>
            </label>
          ) : null}
          {supportsSpeakerSelection() && call.devices.audioOutput.length > 0 ? (
            <label className="block">
              <span className="mb-1 block font-semibold opacity-80">Speaker</span>
              <select
                className="w-full rounded-lg bg-ink-800 px-2 py-1.5"
                value={call.sinkId}
                onChange={(event) => void setSpeaker(event.target.value)}
              >
                <option value="">Default speaker</option>
                {call.devices.audioOutput.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
              </select>
            </label>
          ) : null}
        </div>
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
            {call.video ? (
              <button
                type="button"
                onClick={() => void acceptCall({ audioOnly: true })}
                className="rounded-full bg-white/15 px-4 py-2 text-xs font-semibold hover:bg-white/25"
                aria-label="Answer with audio only"
              >
                Audio only
              </button>
            ) : null}
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
                onClick={() => void toggleMute()}
                className={`grid h-12 w-12 place-items-center rounded-full ${call.muted ? 'bg-white text-ink-900' : 'bg-white/15 hover:bg-white/25'}`}
                aria-label={call.muted ? 'Unmute' : 'Mute'}
              >
                {call.muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
              </button>
            ) : null}
            {active && call.video ? (
              <button
                type="button"
                onClick={() => void toggleCamera()}
                className={`grid h-12 w-12 place-items-center rounded-full ${call.cameraOn ? 'bg-white/15 hover:bg-white/25' : 'bg-white text-ink-900'}`}
                aria-label={call.cameraOn ? 'Turn camera off' : 'Turn camera on'}
              >
                {call.cameraOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
              </button>
            ) : null}
            {active ? (
              <button
                type="button"
                onClick={() => setMenu(menu === 'devices' ? null : 'devices')}
                className="grid h-12 w-12 place-items-center rounded-full bg-white/15 hover:bg-white/25"
                aria-label="Call settings"
                aria-expanded={menu === 'devices'}
                title={supportsSpeakerSelection() ? 'Microphone, camera and speaker' : 'Microphone and camera'}
              >
                {supportsSpeakerSelection() ? <Volume2 className="h-5 w-5" /> : <Settings2 className="h-5 w-5" />}
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

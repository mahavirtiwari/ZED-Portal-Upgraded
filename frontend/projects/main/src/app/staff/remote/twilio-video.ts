/**
 * Twilio Video JS SDK, loaded on demand from Twilio's CDN as the old Remote/Index page did
 * (`//sdk.twilio.com/js/video/releases/2.8.0/twilio-video.min.js`). There is no npm package in the
 * workspace for it; the script is only requested when the assessor presses "Start Assessment".
 * If a stricter Content-Security-Policy is added later, allow `https://sdk.twilio.com` (script-src),
 * `wss://global.vss.twilio.com` and `https://*.twilio.com` (connect-src) and media from the camera.
 */
export const TWILIO_VIDEO_SDK_URL = 'https://sdk.twilio.com/js/video/releases/2.8.0/twilio-video.min.js';

export interface TwilioTrack {
  kind: string;
  attach(): HTMLElement;
  detach(): HTMLElement[];
}

export interface TwilioTrackPublication {
  isSubscribed: boolean;
  track: TwilioTrack | null;
}

export interface TwilioParticipant {
  sid: string;
  identity: string;
  tracks: Map<string, TwilioTrackPublication>;
  on(event: 'trackSubscribed' | 'trackUnsubscribed', cb: (track: TwilioTrack) => void): void;
}

export interface TwilioRoom {
  name: string;
  participants: Map<string, TwilioParticipant>;
  on(event: 'participantConnected' | 'participantDisconnected', cb: (p: TwilioParticipant) => void): void;
  once(event: 'disconnected', cb: () => void): void;
  disconnect(): void;
}

export interface TwilioVideo {
  connect(token: string, options: { audio: boolean; video: { width: number } }): Promise<TwilioRoom>;
}

declare global {
  interface Window {
    Twilio?: { Video?: TwilioVideo };
  }
}

let loading: Promise<TwilioVideo> | null = null;

export function loadTwilioVideo(doc: Document = document): Promise<TwilioVideo> {
  const existing = (doc.defaultView ?? window).Twilio?.Video;
  if (existing) return Promise.resolve(existing);
  loading ??= new Promise<TwilioVideo>((resolve, reject) => {
    const script = doc.createElement('script');
    script.src = TWILIO_VIDEO_SDK_URL;
    script.async = true;
    script.onload = () => {
      const video = (doc.defaultView ?? window).Twilio?.Video;
      if (video) resolve(video);
      else reject(new Error('This browser is not supported by twilio-video.js.'));
    };
    script.onerror = () => {
      loading = null;
      reject(new Error('Could not load the video library. Please check your connection and try again.'));
    };
    doc.head.appendChild(script);
  });
  return loading;
}

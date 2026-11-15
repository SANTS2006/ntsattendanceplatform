import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, RefreshCw, Upload } from 'lucide-react';
import { Button } from '@/components/ui';

type CamError = 'DENIED' | 'NO_CAMERA' | 'UNSUPPORTED' | 'FAILED' | null;

const CAMERA_MESSAGES: Record<Exclude<CamError, null>, string> = {
  DENIED: 'Camera access was blocked. Allow camera access for this site in your browser settings, then try again.',
  NO_CAMERA: 'No camera was found on this device.',
  UNSUPPORTED: 'Your browser cannot open the camera here. You can take a photo with your camera app instead.',
  FAILED: 'The camera could not be started. Close other apps using the camera and try again.',
};

/** Front-camera selfie capture using MediaDevices, with a native-camera file fallback. */
export function SelfieCapture({ onCaptured, busy }: { onCaptured: (blob: Blob, previewUrl: string) => void; busy?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [state, setState] = useState<'idle' | 'starting' | 'live'>('idle');
  const [error, setError] = useState<CamError>(null);

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);
  useEffect(() => stop, [stop]);

  async function start() {
    setError(null);
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError('UNSUPPORTED');
      return;
    }
    setState('starting');
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 960 } }, audio: false });
      stream.current = s;
      setState('live');
      requestAnimationFrame(() => {
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play();
        }
      });
    } catch (e) {
      const name = (e as DOMException).name;
      setError(name === 'NotAllowedError' || name === 'SecurityError' ? 'DENIED' : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'NO_CAMERA' : 'FAILED');
      setState('idle');
    }
  }

  function capture() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const size = Math.min(v.videoWidth, v.videoHeight);
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(size, 900);
    canvas.height = canvas.width;
    const ctx = canvas.getContext('2d')!;
    // Mirror horizontally so the photo matches the preview the student saw.
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(v, (v.videoWidth - size) / 2, (v.videoHeight - size) / 2, size, size, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return setError('FAILED');
        stop();
        setState('idle');
        onCaptured(blob, URL.createObjectURL(blob));
      },
      'image/jpeg',
      0.88,
    );
  }

  return (
    <div className="space-y-3">
      {state !== 'idle' ? (
        <div className="relative mx-auto aspect-square w-full max-w-xs overflow-hidden rounded-2xl bg-slate-900">
          <video ref={video} playsInline muted className="h-full w-full -scale-x-100 object-cover" aria-label="Camera preview" />
          <div className="pointer-events-none absolute inset-6 rounded-full border-2 border-white/60" />
        </div>
      ) : (
        <div className="mx-auto flex aspect-square w-full max-w-xs items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 text-slate-400">
          <Camera className="h-12 w-12" />
        </div>
      )}
      {error && (
        <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700" role="alert">
          {CAMERA_MESSAGES[error]}
        </p>
      )}
      {state === 'live' ? (
        <Button size="lg" className="w-full" onClick={capture} icon={<Camera className="h-5 w-5" />}>
          Capture photo
        </Button>
      ) : (
        <Button size="lg" className="w-full" onClick={start} loading={state === 'starting' || busy} icon={error ? <RefreshCw className="h-5 w-5" /> : <Camera className="h-5 w-5" />}>
          {error ? 'Try camera again' : 'Take a selfie'}
        </Button>
      )}
      {(error === 'UNSUPPORTED' || error === 'FAILED' || error === 'NO_CAMERA') && (
        <label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700">
          <Upload className="h-4 w-4" /> Use camera app
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="user"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onCaptured(f, URL.createObjectURL(f));
            }}
          />
        </label>
      )}
    </div>
  );
}

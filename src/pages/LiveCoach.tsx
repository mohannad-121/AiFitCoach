import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, CheckCircle2, Clock3, RefreshCw, ScanLine, ShieldCheck, TriangleAlert, User } from 'lucide-react';
import { DrawingUtils, FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { Navbar } from '@/components/layout/Navbar';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { assessPose, type PoseFeedback, type SupportedExercise } from '@/lib/poseFeedback';
import { LiveCoachChat, type LiveSessionContext } from '@/components/live/LiveCoachChat';
import { useUser } from '@/contexts/UserContext';

type CameraState = 'idle' | 'starting' | 'live' | 'error';

const exercises = [
  { value: 'plank', en: 'Plank', ar: 'لوح الثبات' },
  { value: 'squat', en: 'Squat', ar: 'القرفصاء' },
  { value: 'push-up', en: 'Push-up', ar: 'تمرين الضغط' },
  { value: 'lunge', en: 'Lunge', ar: 'الاندفاع' },
];

function formatElapsed(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export function LiveCoachPage() {
  const { language } = useLanguage();
  const { profile } = useUser();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const animationRef = useRef<number | null>(null);
  const lastInferenceRef = useRef(0);
  const feedbackCandidateRef = useRef({ key: '', frames: 0 });
  const progressRef = useRef({ analyzedSamples: 0, goodSamples: 0, corrections: {} as Record<string, number> });
  const [cameraState, setCameraState] = useState<CameraState>('idle');
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('default');
  const [exercise, setExercise] = useState('plank');
  const [elapsed, setElapsed] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const [modelState, setModelState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [poseFeedback, setPoseFeedback] = useState<PoseFeedback>({ level: 'waiting', message: 'step_into_frame', score: null });

  const text = useCallback((en: string, ar: string) => (language === 'ar' ? ar : en), [language]);

  const stopCamera = useCallback(() => {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraState('idle');
    setElapsed(0);
    setPoseFeedback({ level: 'waiting', message: 'step_into_frame', score: null });
  }, []);

  const refreshDevices = useCallback(async () => {
    const available = await navigator.mediaDevices.enumerateDevices();
    setDevices(available.filter((device) => device.kind === 'videoinput'));
  }, []);

  const startCamera = useCallback(async (nextFacingMode = facingMode, nextDeviceId = deviceId) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMessage(text('This browser does not support camera access.', 'هذا المتصفح لا يدعم الوصول إلى الكاميرا.'));
      setCameraState('error');
      return;
    }

    const isNewSession = !streamRef.current;
    if (isNewSession) progressRef.current = { analyzedSamples: 0, goodSamples: 0, corrections: {} };
    setCameraState('starting');
    setErrorMessage('');
    streamRef.current?.getTracks().forEach((track) => track.stop());

    try {
      const video: MediaTrackConstraints = nextDeviceId !== 'default'
        ? { deviceId: { exact: nextDeviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
        : { facingMode: { ideal: nextFacingMode }, width: { ideal: 1280 }, height: { ideal: 720 } };
      const stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraState('live');
      setElapsed(0);
      await refreshDevices();
    } catch (error) {
      const denied = error instanceof DOMException && error.name === 'NotAllowedError';
      setErrorMessage(denied
        ? text('Camera permission was denied.', 'تم رفض إذن الكاميرا.')
        : text('The camera could not be started.', 'تعذر تشغيل الكاميرا.'));
      setCameraState('error');
    }
  }, [deviceId, facingMode, refreshDevices, text]);

  const switchCamera = async () => {
    const next = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(next);
    setDeviceId('default');
    await startCamera(next, 'default');
  };

  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
        let landmarker: PoseLandmarker;
        try {
          landmarker = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: '/models/pose_landmarker_lite.task', delegate: 'GPU' },
            runningMode: 'VIDEO',
            numPoses: 1,
            minPoseDetectionConfidence: 0.55,
            minPosePresenceConfidence: 0.55,
            minTrackingConfidence: 0.55,
          });
        } catch {
          landmarker = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: '/models/pose_landmarker_lite.task', delegate: 'CPU' },
            runningMode: 'VIDEO',
            numPoses: 1,
            minPoseDetectionConfidence: 0.55,
            minPosePresenceConfidence: 0.55,
            minTrackingConfidence: 0.55,
          });
        }
        if (cancelled) {
          landmarker.close();
          return;
        }
        landmarkerRef.current = landmarker;
        setModelState('ready');
      } catch {
        if (!cancelled) setModelState('error');
      }
    };
    initialize();
    return () => {
      cancelled = true;
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (cameraState !== 'live' || modelState !== 'ready') return;

    const analyze = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const landmarker = landmarkerRef.current;
      if (!video || !canvas || !landmarker || video.readyState < 2) {
        animationRef.current = requestAnimationFrame(analyze);
        return;
      }

      const now = performance.now();
      if (now - lastInferenceRef.current >= 100) {
        lastInferenceRef.current = now;
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }
        const context = canvas.getContext('2d');
        if (context) {
          context.clearRect(0, 0, canvas.width, canvas.height);
          const result = landmarker.detectForVideo(video, now);
          const landmarks = result.landmarks[0];
          if (landmarks) {
            const drawing = new DrawingUtils(context);
            drawing.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, { color: '#22c55e', lineWidth: 3 });
            drawing.drawLandmarks(landmarks, { color: '#ffffff', fillColor: '#0ea5e9', lineWidth: 1, radius: 3 });
          }

          const nextFeedback = landmarks
            ? assessPose(exercise as SupportedExercise, landmarks)
            : { level: 'waiting' as const, message: 'step_into_frame', score: null };
          if (nextFeedback.score !== null) {
            const progress = progressRef.current;
            progress.analyzedSamples += 1;
            if (nextFeedback.level === 'good') progress.goodSamples += 1;
            if (nextFeedback.level === 'adjust') {
              progress.corrections[nextFeedback.message] = (progress.corrections[nextFeedback.message] || 0) + 1;
            }
          }
          const key = `${nextFeedback.level}:${nextFeedback.message}`;
          const candidate = feedbackCandidateRef.current;
          candidate.frames = candidate.key === key ? candidate.frames + 1 : 1;
          candidate.key = key;
          if (candidate.frames >= 3) setPoseFeedback(nextFeedback);
        }
      }
      animationRef.current = requestAnimationFrame(analyze);
    };

    animationRef.current = requestAnimationFrame(analyze);
    return () => {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
      canvasRef.current?.getContext('2d')?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    };
  }, [cameraState, exercise, modelState]);

  useEffect(() => {
    feedbackCandidateRef.current = { key: '', frames: 0 };
    progressRef.current = { analyzedSamples: 0, goodSamples: 0, corrections: {} };
    setPoseFeedback({ level: 'waiting', message: 'step_into_frame', score: null });
  }, [exercise]);

  const getSessionContext = useCallback((): LiveSessionContext => {
    const progress = progressRef.current;
    const cue = feedbackCopy[poseFeedback.message]?.[0] || poseFeedback.message;
    return {
      exercise,
      elapsed_seconds: elapsed,
      camera_active: cameraState === 'live',
      pose_analysis_ready: modelState === 'ready',
      current_feedback: { level: poseFeedback.level, cue, score: poseFeedback.score },
      analyzed_samples: progress.analyzedSamples,
      correct_sample_ratio: progress.analyzedSamples
        ? Number((progress.goodSamples / progress.analyzedSamples).toFixed(2))
        : null,
      recurring_corrections: Object.entries(progress.corrections)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([message, samples]) => ({ cue: feedbackCopy[message]?.[0] || message, samples })),
    };
  }, [cameraState, elapsed, exercise, modelState, poseFeedback]);

  useEffect(() => {
    if (cameraState !== 'live') return;
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [cameraState]);

  useEffect(() => stopCamera, [stopCamera]);

  return (
    <div className="min-h-screen pb-24 md:pb-10">
      <Navbar />
      <main className="mx-auto w-full max-w-[1800px] px-4 pt-20 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)_22rem] lg:items-start">
        <div className="flex flex-row items-center gap-4 text-left lg:sticky lg:top-24 lg:flex-col lg:items-center lg:pt-2 lg:text-center" dir="ltr">
          <div className="relative h-20 w-20 shrink-0 rounded-full bg-gradient-primary p-[3px] shadow-glow lg:h-36 lg:w-36">
            <div className="h-full w-full overflow-hidden rounded-full bg-secondary">
              {profile?.avatarUrl ? (
                <img src={profile.avatarUrl} alt={profile.name || 'Profile'} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-card">
                  <User className="h-14 w-14 text-primary" />
                </div>
              )}
            </div>
            <span className="absolute bottom-2 right-2 h-4 w-4 rounded-full border-2 border-background bg-emerald-500" />
          </div>
          <h2 className="text-lg font-semibold text-foreground lg:mt-3">{profile?.name || text('Your live session', 'جلستك المباشرة')}</h2>
        </div>
        <div className="min-w-0">
        <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-display text-4xl text-foreground md:text-5xl">
              {text('LIVE FORM COACH', 'مدرب الأداء المباشر')}
            </h1>
            <p className="mt-1 text-muted-foreground">{text('Real-time training session', 'جلسة تدريب فورية')}</p>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
            {text('Private live view', 'عرض مباشر خاص')}
          </div>
        </div>

          <section className="overflow-hidden rounded-lg border border-border/60 bg-black shadow-xl">
            <div className="relative aspect-[3/4] w-full sm:aspect-video">
              <video ref={videoRef} muted playsInline className={cn(
                'h-full w-full object-cover',
                facingMode === 'user' && 'scale-x-[-1]',
                cameraState !== 'live' && 'invisible'
              )} />
              <canvas ref={canvasRef} className={cn(
                'pointer-events-none absolute inset-0 h-full w-full object-cover',
                facingMode === 'user' && 'scale-x-[-1]',
                cameraState !== 'live' && 'hidden'
              )} />

              {cameraState !== 'live' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-zinc-950 px-6 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900">
                    {cameraState === 'error'
                      ? <TriangleAlert className="h-8 w-8 text-amber-400" />
                      : <Camera className="h-8 w-8 text-zinc-300" />}
                  </div>
                  <p className="max-w-sm text-sm text-zinc-400">
                    {cameraState === 'error' ? errorMessage : cameraState === 'starting'
                      ? text('Starting camera...', 'جارٍ تشغيل الكاميرا...')
                      : text('Camera is off', 'الكاميرا متوقفة')}
                  </p>
                </div>
              )}

              {cameraState === 'live' && (
                <>
                  <div className="absolute left-3 top-3 flex items-center gap-2 rounded-md bg-black/70 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
                    {text('LIVE', 'مباشر')}
                  </div>
                  <div className="absolute right-3 top-3 flex items-center gap-2 rounded-md bg-black/70 px-3 py-1.5 font-mono text-sm text-white backdrop-blur-sm">
                    <Clock3 className="h-4 w-4" />{formatElapsed(elapsed)}
                  </div>
                  <div className="pointer-events-none absolute inset-[8%] rounded-lg border border-white/35">
                    <span className="absolute -left-px -top-px h-8 w-8 border-l-2 border-t-2 border-primary" />
                    <span className="absolute -right-px -top-px h-8 w-8 border-r-2 border-t-2 border-primary" />
                    <span className="absolute -bottom-px -left-px h-8 w-8 border-b-2 border-l-2 border-primary" />
                    <span className="absolute -bottom-px -right-px h-8 w-8 border-b-2 border-r-2 border-primary" />
                  </div>
                </>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3 border-t border-zinc-800 bg-zinc-950 p-4">
              {cameraState === 'live' ? (
                <>
                  <Button variant="destructive" onClick={stopCamera}><CameraOff className="mr-2 h-4 w-4" />{text('Stop', 'إيقاف')}</Button>
                  <Button variant="secondary" onClick={switchCamera}><RefreshCw className="mr-2 h-4 w-4" />{text('Switch camera', 'تبديل الكاميرا')}</Button>
                </>
              ) : (
                <Button onClick={() => startCamera()} disabled={cameraState === 'starting'}><Camera className="mr-2 h-4 w-4" />{text('Start camera', 'تشغيل الكاميرا')}</Button>
              )}
            </div>
          </section>
        </div>

          <aside className="space-y-5">
            <FeedbackPanel feedback={poseFeedback} modelState={modelState} text={text} />
            <LiveCoachChat getSessionContext={getSessionContext} language={language} />

            <div className="border-b border-border pb-5">
              <Label htmlFor="exercise">{text('Exercise', 'التمرين')}</Label>
              <Select value={exercise} onValueChange={setExercise}>
                <SelectTrigger id="exercise" className="mt-2"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {exercises.map((item) => <SelectItem key={item.value} value={item.value}>{language === 'ar' ? item.ar : item.en}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {devices.length > 1 && (
              <div className="border-b border-border pb-5">
                <Label htmlFor="camera-device">{text('Camera', 'الكاميرا')}</Label>
                <Select value={deviceId} onValueChange={async (value) => {
                  setDeviceId(value);
                  if (cameraState === 'live') await startCamera(facingMode, value);
                }}>
                  <SelectTrigger id="camera-device" className="mt-2"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">{text('Automatic', 'تلقائي')}</SelectItem>
                    {devices.map((device, index) => (
                      <SelectItem key={device.deviceId} value={device.deviceId}>{device.label || `${text('Camera', 'كاميرا')} ${index + 1}`}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-3">
              <StatusRow label={text('Camera', 'الكاميرا')} value={cameraState === 'live' ? text('Connected', 'متصلة') : text('Off', 'متوقفة')} active={cameraState === 'live'} />
              <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">{text('Session', 'الجلسة')}</span><span className="font-mono font-medium">{formatElapsed(elapsed)}</span></div>
              <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">{text('Form analysis', 'تحليل الأداء')}</span><span className={cn('flex items-center gap-1.5', modelState === 'ready' ? 'text-emerald-500' : 'text-muted-foreground')}><ScanLine className="h-4 w-4" />{modelState === 'ready' ? text('Ready', 'جاهز') : modelState === 'loading' ? text('Loading', 'جارٍ التحميل') : text('Unavailable', 'غير متاح')}</span></div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

const feedbackCopy: Record<string, [string, string]> = {
  step_into_frame: ['Step into the frame', 'قف أمام الكاميرا'],
  full_body_required: ['Keep your full body visible', 'أظهر جسمك كاملاً'],
  both_legs_required: ['Keep both legs visible', 'أظهر الساقين كاملتين'],
  form_good: ['Good form. Keep going!', 'أداؤك جيد. استمر!'],
  raise_hips: ['Raise your hips slightly', 'ارفع الوركين قليلاً'],
  lower_hips: ['Lower your hips slightly', 'اخفض الوركين قليلاً'],
  open_elbows: ['Open your elbow angle', 'وسّع زاوية المرفق'],
  chest_up: ['Lift your chest', 'ارفع صدرك'],
  lower_squat: ['Bend your knees and lower', 'اثنِ ركبتيك وانخفض'],
  squat_too_deep: ['Rise slightly', 'ارتفع قليلاً'],
  lower_lunge: ['Lower into the lunge', 'انخفض أكثر في الاندفاع'],
  shorten_lunge: ['Shorten your stance slightly', 'قلّل المسافة بين القدمين'],
  bend_back_knee: ['Bend your back knee', 'اثنِ الركبة الخلفية'],
};

function FeedbackPanel({ feedback, modelState, text }: {
  feedback: PoseFeedback;
  modelState: 'loading' | 'ready' | 'error';
  text: (en: string, ar: string) => string;
}) {
  const copy = feedbackCopy[feedback.message] ?? feedbackCopy.step_into_frame;
  const level = modelState === 'error' ? 'adjust' : feedback.level;
  const message = modelState === 'loading'
    ? text('Preparing pose analysis...', 'جارٍ تجهيز تحليل الحركة...')
    : modelState === 'error'
      ? text('Pose analysis could not start', 'تعذر تشغيل تحليل الحركة')
      : text(copy[0], copy[1]);
  return (
    <div className={cn(
      'rounded-lg border p-4',
      level === 'good' && 'border-emerald-500/40 bg-emerald-500/10',
      level === 'adjust' && 'border-amber-500/40 bg-amber-500/10',
      level === 'waiting' && 'border-border bg-card/40'
    )}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className={cn('text-xs font-semibold uppercase', level === 'good' ? 'text-emerald-500' : level === 'adjust' ? 'text-amber-500' : 'text-muted-foreground')}>
          {level === 'good' ? text('Correct', 'صحيح') : level === 'adjust' ? text('Adjust', 'عدّل') : text('Watching', 'جارٍ التحليل')}
        </span>
        {feedback.score !== null && <span className="font-mono text-sm font-semibold">{feedback.score}%</span>}
      </div>
      <p className="text-sm font-medium text-foreground">{message}</p>
    </div>
  );
}

function StatusRow({ label, value, active }: { label: string; value: string; active: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('flex items-center gap-1.5 font-medium', active ? 'text-emerald-500' : 'text-muted-foreground')}>
        {active && <CheckCircle2 className="h-4 w-4" />}{value}
      </span>
    </div>
  );
}

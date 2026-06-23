import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, CameraOff, CheckCircle2, Clock3, RefreshCw, ScanLine, ShieldCheck, TriangleAlert, User, Sparkles, Activity, Radar, Cpu, Eye } from 'lucide-react';
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
  const isArabic = language === 'ar';

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
            drawing.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, { color: '#67e8f9', lineWidth: 3 });
            drawing.drawLandmarks(landmarks, { color: '#ffffff', fillColor: '#22c55e', lineWidth: 1.4, radius: 3.4 });
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

  const selectedExerciseLabel = useMemo(() => {
    const item = exercises.find((entry) => entry.value === exercise);
    return item ? (isArabic ? item.ar : item.en) : exercise;
  }, [exercise, isArabic]);

  const liveReady = cameraState === 'live';
  const trackingReady = modelState === 'ready';
  const analysisActive = liveReady && trackingReady;
  const needsVisibilityAdjustment = poseFeedback.message === 'full_body_required' || poseFeedback.message === 'step_into_frame';

  const guidanceItems = [
    { label: text('Full body visible', 'ظهور الجسم كاملًا'), active: !needsVisibilityAdjustment },
    { label: text('Good lighting', 'إضاءة جيدة'), active: liveReady },
    { label: text('Camera stable', 'ثبات الكاميرا'), active: liveReady },
    { label: text('Exercise selected', 'تم اختيار التمرين'), active: Boolean(exercise) },
  ];

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#060816] pb-24 text-foreground md:pb-10">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(129,92,255,0.18),_transparent_28%),radial-gradient(circle_at_82%_18%,_rgba(34,211,238,0.12),_transparent_24%),radial-gradient(circle_at_50%_100%,_rgba(236,72,153,0.1),_transparent_34%)]" />
        <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:54px_54px]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_transparent_48%,_rgba(1,3,10,0.76)_100%)]" />
      </div>
      <Navbar />
      <main className="relative z-10 mx-auto w-full max-w-[1500px] px-4 pt-20 sm:px-6 lg:px-8">
        <section className="mb-6 rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(16,18,32,0.86),rgba(9,11,22,0.72))] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.32)] backdrop-blur-2xl">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.32em] text-cyan-100/80">
              {text('LIVE AI FORM ANALYSIS', 'تحليل الأداء المباشر بالذكاء الاصطناعي')}
            </span>
            <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-[11px] font-semibold text-emerald-200">
              {liveReady ? text('Live', 'مباشر') : text('Ready', 'جاهز')}
            </span>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-medium text-muted-foreground">
              {text('Private live view', 'عرض مباشر خاص')}
            </span>
          </div>
          <h1 className="text-4xl font-semibold tracking-tight text-white md:text-5xl">
            {text('Live Form Coach', 'مدرب الأداء المباشر')}
          </h1>
          <div className="relative mt-3 h-1.5 w-44 overflow-hidden rounded-full bg-white/8">
            <div className="absolute inset-y-0 left-0 w-1/2 rounded-full bg-gradient-to-r from-fuchsia-400 via-violet-400 to-cyan-300 blur-[1px]" />
          </div>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-muted-foreground md:text-base">
            {text('Real-time posture tracking, movement feedback, and AI-powered exercise correction.', 'تتبع فوري للوضعية، وملاحظات للحركة، وتصحيح ذكي للتمرين في الوقت الحقيقي.')}
          </p>
        </section>

        <div className="grid gap-6 xl:grid-cols-[17rem_minmax(0,1fr)_23rem] xl:items-start">
          <aside className="space-y-4 xl:sticky xl:top-24">
            <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(17,20,37,0.9),rgba(10,12,24,0.92))] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.28)] backdrop-blur-2xl" dir="ltr">
              <div className="flex flex-row items-center gap-4 text-left xl:flex-col xl:items-center xl:text-center">
                <div className="relative h-20 w-20 shrink-0 rounded-full bg-gradient-primary p-[3px] shadow-[0_0_40px_rgba(168,85,247,0.24)] xl:h-28 xl:w-28">
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
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-semibold text-foreground xl:mt-3">{profile?.name || text('Your live session', 'جلستك المباشرة')}</h2>
                  <div className="mt-2 flex flex-wrap gap-2 xl:justify-center">
                    {profile?.goal && (
                      <span className="rounded-full border border-fuchsia-300/20 bg-fuchsia-500/10 px-3 py-1 text-[11px] font-medium text-fuchsia-100">
                        {profile.goal}
                      </span>
                    )}
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] text-muted-foreground">
                      {text('Active Session', 'جلسة نشطة')}
                    </span>
                  </div>
                </div>
              </div>
              <div className="mt-4 grid gap-2 text-sm">
                <StatusRow label={text('Camera connected', 'الكاميرا متصلة')} value={liveReady ? text('Yes', 'نعم') : text('Waiting', 'انتظار')} active={liveReady} />
                <StatusRow label={text('Pose tracking ready', 'تتبع الحركة جاهز')} value={trackingReady ? text('Ready', 'جاهز') : text('Loading', 'جارٍ التحميل')} active={trackingReady} />
              </div>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(17,20,37,0.9),rgba(10,12,24,0.92))] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.28)] backdrop-blur-2xl">
              <div className="mb-3 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-cyan-300" />
                <h3 className="text-sm font-semibold text-white">{text('Tracking Guidance', 'إرشادات التتبع')}</h3>
              </div>
              <p className="mb-4 text-sm leading-6 text-muted-foreground">
                {text('Keep your full body visible inside the frame for better movement analysis.', 'حافظ على ظهور جسمك كاملًا داخل الإطار للحصول على تحليل أدق للحركة.')}
              </p>
              <div className="space-y-2">
                {guidanceItems.map((item) => (
                  <div key={item.label} className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2.5 text-sm">
                    <span className="text-foreground/90">{item.label}</span>
                    <span className={cn('rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em]', item.active ? 'bg-emerald-400/12 text-emerald-200' : 'bg-white/6 text-muted-foreground')}>
                      {item.active ? text('OK', 'جاهز') : text('Guide', 'تنبيه')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </aside>

          <div className="min-w-0">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-muted-foreground">
                {text('Selected Exercise', 'التمرين المختار')}: <span className="text-white">{selectedExerciseLabel}</span>
              </div>
              <div className={cn('rounded-full border px-3 py-1.5 text-xs', analysisActive ? 'border-cyan-300/20 bg-cyan-400/10 text-cyan-100' : 'border-white/10 bg-white/[0.04] text-muted-foreground')}>
                {analysisActive ? text('AI Tracking', 'التتبع الذكي') : text('Scanner idle', 'الماسح في وضع الانتظار')}
              </div>
            </div>

            <section className="overflow-hidden rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(12,14,28,0.95),rgba(5,7,16,0.98))] shadow-[0_28px_90px_rgba(0,0,0,0.4)]">
              <div className="border-b border-white/10 bg-white/[0.03] px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-red-400/30 bg-red-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-red-200">
                      <span className="mr-2 inline-block h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                      {text('LIVE', 'مباشر')}
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] text-muted-foreground">
                      {text('Private live view', 'عرض مباشر خاص')}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-foreground">
                      <Clock3 className="mr-1 inline h-3.5 w-3.5" />{formatElapsed(elapsed)}
                    </span>
                    <span className={cn('rounded-full border px-3 py-1', trackingReady ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200' : 'border-white/10 bg-white/[0.04] text-muted-foreground')}>
                      <Radar className="mr-1 inline h-3.5 w-3.5" />
                      {trackingReady ? text('Pose detected', 'تم اكتشاف الحركة') : text('Searching', 'جاري البحث')}
                    </span>
                  </div>
                </div>
              </div>

              <div className="relative aspect-[3/4] w-full bg-black sm:aspect-video">
                <div className="pointer-events-none absolute inset-0 z-[1] bg-[radial-gradient(circle_at_center,_rgba(56,189,248,0.08),_transparent_55%)]" />
                <div className="pointer-events-none absolute inset-0 z-[1] opacity-[0.08] [background-image:linear-gradient(rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:32px_32px]" />
                <video ref={videoRef} muted playsInline className={cn(
                  'h-full w-full object-cover',
                  facingMode === 'user' && 'scale-x-[-1]',
                  cameraState !== 'live' && 'invisible'
                )} />
                <canvas ref={canvasRef} className={cn(
                  'pointer-events-none absolute inset-0 z-[2] h-full w-full object-cover',
                  facingMode === 'user' && 'scale-x-[-1]',
                  cameraState !== 'live' && 'hidden'
                )} />
                <div className="pointer-events-none absolute inset-[7%] z-[3] rounded-[28px] border border-white/15 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.02)]">
                  <span className="absolute -left-px -top-px h-10 w-10 border-l-2 border-t-2 border-cyan-300/80" />
                  <span className="absolute -right-px -top-px h-10 w-10 border-r-2 border-t-2 border-fuchsia-300/80" />
                  <span className="absolute -bottom-px -left-px h-10 w-10 border-b-2 border-l-2 border-fuchsia-300/80" />
                  <span className="absolute -bottom-px -right-px h-10 w-10 border-b-2 border-r-2 border-cyan-300/80" />
                </div>

                {cameraState !== 'live' && (
                  <div className="absolute inset-0 z-[4] flex flex-col items-center justify-center gap-4 bg-zinc-950/95 px-6 text-center backdrop-blur-sm">
                    <div className="flex h-20 w-20 items-center justify-center rounded-full border border-fuchsia-300/15 bg-white/[0.03] shadow-[0_0_60px_rgba(168,85,247,0.14)]">
                      {cameraState === 'error'
                        ? <TriangleAlert className="h-8 w-8 text-amber-400" />
                        : <Camera className="h-8 w-8 text-zinc-300" />}
                    </div>
                    <h3 className="text-2xl font-semibold text-white">
                      {cameraState === 'error'
                        ? text('Camera setup issue', 'مشكلة في إعداد الكاميرا')
                        : text('Start your live form session', 'ابدأ جلسة الأداء المباشر')}
                    </h3>
                    <p className="max-w-xl text-sm leading-7 text-zinc-400">
                      {cameraState === 'error' ? errorMessage : cameraState === 'starting'
                        ? text('Starting camera...', 'جارٍ تشغيل الكاميرا...')
                        : text('Your AI Coach will track movement and help correct your exercise form in real time.', 'سيقوم مدربك الذكي بتتبع الحركة ومساعدتك على تصحيح التمرين في الوقت الحقيقي.')}
                    </p>
                    {cameraState !== 'starting' && cameraState !== 'error' && (
                      <Button onClick={() => startCamera()} className="rounded-full px-6" disabled={cameraState === 'starting'}>
                        <Camera className="mr-2 h-4 w-4" />
                        {text('Start Camera', 'تشغيل الكاميرا')}
                      </Button>
                    )}
                    <p className="text-xs text-zinc-500">
                      {text('Your live view is used for real-time form feedback.', 'يُستخدم العرض المباشر لتقديم ملاحظات فورية على الأداء.')}
                    </p>
                  </div>
                )}

                {cameraState === 'live' && (
                  <>
                    <div className="pointer-events-none absolute inset-x-[12%] top-[24%] z-[3] h-px bg-gradient-to-r from-transparent via-cyan-300/70 to-transparent shadow-[0_0_14px_rgba(34,211,238,0.45)]" />
                    <div className="pointer-events-none absolute bottom-5 right-5 z-[3] rounded-full border border-white/10 bg-black/45 px-3 py-1.5 text-[11px] text-cyan-100 backdrop-blur-md">
                      <Cpu className="mr-1 inline h-3.5 w-3.5" />
                      {analysisActive ? text('Analyzing joints', 'تحليل المفاصل') : text('AI tracking ready', 'التتبع الذكي جاهز')}
                    </div>
                  </>
                )}
              </div>

              <div className="border-t border-white/10 bg-[linear-gradient(180deg,rgba(7,9,18,0.88),rgba(7,9,18,0.96))] px-4 py-4">
                <div className="mb-3 flex flex-wrap gap-2">
                  <div className={cn('rounded-full border px-3 py-1.5 text-xs', liveReady ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200' : 'border-white/10 bg-white/[0.04] text-muted-foreground')}>
                    <Camera className="mr-1 inline h-3.5 w-3.5" />
                    {text('Camera', 'الكاميرا')}: {liveReady ? text('Connected', 'متصلة') : text('Off', 'متوقفة')}
                  </div>
                  <div className={cn('rounded-full border px-3 py-1.5 text-xs', trackingReady ? 'border-cyan-300/20 bg-cyan-400/10 text-cyan-100' : 'border-white/10 bg-white/[0.04] text-muted-foreground')}>
                    <Radar className="mr-1 inline h-3.5 w-3.5" />
                    {text('Pose tracking', 'تتبع الحركة')}: {trackingReady ? text('Ready', 'جاهز') : text('Loading', 'تحميل')}
                  </div>
                  <div className={cn('rounded-full border px-3 py-1.5 text-xs', analysisActive ? 'border-fuchsia-300/20 bg-fuchsia-500/10 text-fuchsia-100' : 'border-white/10 bg-white/[0.04] text-muted-foreground')}>
                    <Activity className="mr-1 inline h-3.5 w-3.5" />
                    {text('Form analysis', 'تحليل الأداء')}: {analysisActive ? text('Analyzing', 'جارٍ التحليل') : text('Stand by', 'انتظار')}
                  </div>
                  <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-muted-foreground">
                    <Eye className="mr-1 inline h-3.5 w-3.5" />
                    {text('Exercise', 'التمرين')}: <span className="text-foreground">{selectedExerciseLabel}</span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-3">
                  {cameraState === 'live' ? (
                    <>
                      <Button variant="destructive" onClick={stopCamera} className="rounded-full px-5 shadow-[0_16px_36px_rgba(239,68,68,0.22)]"><CameraOff className="mr-2 h-4 w-4" />{text('Stop Session', 'إيقاف الجلسة')}</Button>
                      <Button variant="secondary" onClick={switchCamera} className="rounded-full border border-white/10 bg-white/[0.06] px-5"><RefreshCw className="mr-2 h-4 w-4" />{text('Switch camera', 'تبديل الكاميرا')}</Button>
                    </>
                  ) : (
                    <Button onClick={() => startCamera()} disabled={cameraState === 'starting'} className="rounded-full px-6"><Camera className="mr-2 h-4 w-4" />{text('Start camera', 'تشغيل الكاميرا')}</Button>
                  )}
                </div>
              </div>
            </section>
          </div>

          <aside className="space-y-5">
            <FeedbackPanel feedback={poseFeedback} modelState={modelState} text={text} />
            <LiveCoachChat getSessionContext={getSessionContext} language={language} />

            <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(17,20,37,0.9),rgba(10,12,24,0.92))] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.28)] backdrop-blur-2xl">
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.26em] text-cyan-100/70">{text('Selected Exercise', 'التمرين المختار')}</div>
              <Label htmlFor="exercise" className="text-sm font-semibold text-white">{text('Exercise', 'التمرين')}</Label>
              <p className="mt-1 text-xs leading-6 text-muted-foreground">
                {text('Choose the exercise so your AI Coach can evaluate the correct form.', 'اختر التمرين حتى يتمكن المدرب الذكي من تقييم الأداء الصحيح.')}
              </p>
              <Select value={exercise} onValueChange={setExercise}>
                <SelectTrigger id="exercise" className="mt-3 rounded-2xl border-white/10 bg-black/20"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {exercises.map((item) => <SelectItem key={item.value} value={item.value}>{language === 'ar' ? item.ar : item.en}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {devices.length > 1 && (
              <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(17,20,37,0.9),rgba(10,12,24,0.92))] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.28)] backdrop-blur-2xl">
                <Label htmlFor="camera-device" className="text-sm font-semibold text-white">{text('Camera', 'الكاميرا')}</Label>
                <Select value={deviceId} onValueChange={async (value) => {
                  setDeviceId(value);
                  if (cameraState === 'live') await startCamera(facingMode, value);
                }}>
                  <SelectTrigger id="camera-device" className="mt-3 rounded-2xl border-white/10 bg-black/20"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">{text('Automatic', 'تلقائي')}</SelectItem>
                    {devices.map((device, index) => (
                      <SelectItem key={device.deviceId} value={device.deviceId}>{device.label || `${text('Camera', 'كاميرا')} ${index + 1}`}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(17,20,37,0.9),rgba(10,12,24,0.92))] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.28)] backdrop-blur-2xl">
              <div className="mb-4 flex items-center gap-2">
                <Activity className="h-4 w-4 text-cyan-300" />
                <h3 className="text-sm font-semibold text-white">{text('Session Status', 'حالة الجلسة')}</h3>
              </div>
              <div className="space-y-3">
                <StatusRow label={text('Camera', 'الكاميرا')} value={cameraState === 'live' ? text('Connected', 'متصلة') : text('Off', 'متوقفة')} active={cameraState === 'live'} />
                <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">{text('Session', 'الجلسة')}</span><span className="font-mono font-medium">{formatElapsed(elapsed)}</span></div>
                <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">{text('Form analysis', 'تحليل الأداء')}</span><span className={cn('flex items-center gap-1.5', modelState === 'ready' ? 'text-emerald-500' : 'text-muted-foreground')}><ScanLine className="h-4 w-4" />{modelState === 'ready' ? text('Ready', 'جاهز') : modelState === 'loading' ? text('Loading', 'جارٍ التحميل') : text('Unavailable', 'غير متاح')}</span></div>
                <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">{text('Exercise', 'التمرين')}</span><span className="font-medium text-foreground">{selectedExerciseLabel}</span></div>
                <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">{text('Visibility', 'الظهور')}</span><span className={cn('font-medium', needsVisibilityAdjustment ? 'text-amber-400' : 'text-emerald-400')}>{needsVisibilityAdjustment ? text('Needs adjustment', 'يحتاج تعديل') : text('Full body visible', 'الجسم ظاهر')}</span></div>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

const feedbackCopy: Record<string, [string, string]> = {
  step_into_frame: ['Step into the frame', 'قف أمام الكاميرا'],
  full_body_required: ['Keep your full body visible', 'أظهر جسمك كاملًا'],
  both_legs_required: ['Keep both legs visible', 'أظهر الساقين كاملتين'],
  form_good: ['Good form. Keep going!', 'أداؤك جيد. استمر!'],
  raise_hips: ['Raise your hips slightly', 'ارفع الوركين قليلًا'],
  lower_hips: ['Lower your hips slightly', 'اخفض الوركين قليلًا'],
  open_elbows: ['Open your elbow angle', 'وسّع زاوية المرفق'],
  chest_up: ['Lift your chest', 'ارفع صدرك'],
  lower_squat: ['Bend your knees and lower', 'اثنِ ركبتيك وانخفض'],
  squat_too_deep: ['Rise slightly', 'ارتفع قليلًا'],
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
      'rounded-[28px] border p-5 shadow-[0_20px_60px_rgba(0,0,0,0.24)] backdrop-blur-2xl',
      level === 'good' && 'border-emerald-500/30 bg-emerald-500/10',
      level === 'adjust' && 'border-amber-500/30 bg-amber-500/10',
      level === 'waiting' && 'border-white/10 bg-[linear-gradient(180deg,rgba(17,20,37,0.9),rgba(10,12,24,0.92))]'
    )}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className={cn('text-xs font-semibold uppercase tracking-[0.24em]', level === 'good' ? 'text-emerald-300' : level === 'adjust' ? 'text-amber-300' : 'text-cyan-100/70')}>
          {level === 'good' ? text('Good form', 'أداء جيد') : level === 'adjust' ? text('Adjust posture', 'عدّل وضعيتك') : text('Watching', 'جاري التتبع')}
        </span>
        {feedback.score !== null && <span className="font-mono text-sm font-semibold">{feedback.score}%</span>}
      </div>
      <p className="text-sm font-medium leading-7 text-foreground">{message}</p>
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

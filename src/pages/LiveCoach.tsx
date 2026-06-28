import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { Camera, CameraOff, CheckCircle2, Clock3, RefreshCw, ScanLine, ShieldCheck, TriangleAlert, User, Sparkles, Activity, Radar, Cpu, Eye, Search, Play, Pause, RotateCcw, Dumbbell, Volume2, VolumeX } from 'lucide-react';
import { DrawingUtils, FilesetResolver, PoseLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision';
import { Navbar } from '@/components/layout/Navbar';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { assessPose, estimatePoseConfidence, type PoseFeedback, type SupportedExercise } from '@/lib/poseFeedback';
import { LiveCoachChat, type LiveSessionContext } from '@/components/live/LiveCoachChat';
import { useUser } from '@/contexts/UserContext';
import { exercises as exerciseCatalog, type Exercise } from '@/data/exercises';
import { localizedLabel, repairMojibake } from '@/lib/text';
import { getExerciseTrackingConfig, normalizeExerciseName, type ExerciseTrackingConfig } from '@/lib/exerciseTracking';

type CameraState = 'idle' | 'starting' | 'live' | 'error';
type CameraIssue = 'permission-denied' | 'no-camera' | 'unsupported' | 'unknown' | null;
type DifficultyLevel = 'normal' | 'advanced';
type CueSeverity = 'good' | 'caution' | 'correction' | 'camera-setup';

interface LiveCoachRouteState {
  exerciseId?: string;
  exerciseName?: string;
}

interface LiveExercise {
  source: Exercise;
  id: string;
  name: string;
  nameAr: string;
  difficulty: DifficultyLevel;
  tracking: ExerciseTrackingConfig;
}

interface PoseQuality {
  visibleLandmarks: number;
  averageVisibility: number;
  centered: boolean;
  stableFrames: number;
  stable: boolean;
  usable: boolean;
  issue: string | null;
}

interface CoachingCue {
  key: string;
  severity: CueSeverity;
  en: string;
  ar: string;
  speak: boolean;
}

const advancedExerciseTerms = [
  'barbell',
  'bench',
  'bulgarian',
  'cable',
  'chin-up',
  'deadlift',
  'decline',
  'hip thrust',
  'machine',
  'nordic',
  'pull-up',
  'romanian',
  'single-leg',
];

const POSE_WASM_PATH = '/mediapipe/wasm';
const POSE_MODEL_PATH = '/models/pose_landmarker_lite.task';
const SMOOTHING_ALPHA = 0.62;
const MIN_VISIBLE_LANDMARKS = 18;
const MIN_AVERAGE_VISIBILITY = 0.48;
const CALIBRATION_STABLE_FRAMES = 8;
const VOICE_COOLDOWN_MS = 8000;

function classifyExerciseDifficulty(exercise: Exercise): DifficultyLevel {
  const searchable = `${exercise.id} ${exercise.name}`.toLowerCase();

  // The exercise catalog does not expose a stable difficulty field yet.
  // Be conservative: only clearly loaded, unilateral, machine, or advanced
  // movement names are classified as advanced; everything else stays normal.
  if (advancedExerciseTerms.some((term) => searchable.includes(term))) return 'advanced';
  if (exercise.goal === 'bulking' && exercise.location === 'gym') return 'advanced';
  return 'normal';
}

function toLiveExercise(exercise: Exercise): LiveExercise {
  return {
    source: exercise,
    id: exercise.id,
    name: repairMojibake(exercise.name),
    nameAr: repairMojibake(exercise.nameAr || exercise.name),
    difficulty: classifyExerciseDifficulty(exercise),
    tracking: getExerciseTrackingConfig(exercise),
  };
}

function createPoseFeedback(message = 'step_into_frame', confidence = 0, supportLevel: PoseFeedback['supportLevel'] = 'basic'): PoseFeedback {
  return {
    level: 'waiting',
    message,
    score: null,
    status: message === 'basic_tracking' ? 'tracking_basic' : 'waiting_for_body',
    confidence,
    correction: message,
    repPhase: null,
    supportLevel,
  };
}

function formatElapsed(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function emptyPoseQuality(): PoseQuality {
  return {
    visibleLandmarks: 0,
    averageVisibility: 0,
    centered: false,
    stableFrames: 0,
    stable: false,
    usable: false,
    issue: 'step_into_frame',
  };
}

function smoothLandmarks(previous: NormalizedLandmark[] | null, current: NormalizedLandmark[]) {
  if (!previous || previous.length !== current.length) return current.map((point) => ({ ...point }));
  return current.map((point, index) => ({
    ...point,
    x: previous[index].x + (point.x - previous[index].x) * SMOOTHING_ALPHA,
    y: previous[index].y + (point.y - previous[index].y) * SMOOTHING_ALPHA,
    z: previous[index].z + (point.z - previous[index].z) * SMOOTHING_ALPHA,
    visibility: point.visibility ?? previous[index].visibility,
  }));
}

function getPoseBounds(landmarks: NormalizedLandmark[]) {
  const visible = landmarks.filter((point) => (point.visibility ?? 0) >= 0.35);
  const points = visible.length >= 8 ? visible : landmarks;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function assessLandmarkQuality(landmarks: NormalizedLandmark[] | null, previousStableFrames: number): PoseQuality {
  if (!landmarks?.length) return emptyPoseQuality();

  const visibleLandmarks = landmarks.filter((point) => (point.visibility ?? 0) >= 0.45).length;
  const averageVisibility = landmarks.reduce((sum, point) => sum + (point.visibility ?? 0), 0) / landmarks.length;
  const bounds = getPoseBounds(landmarks);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const centered = centerX > 0.2 && centerX < 0.8 && centerY > 0.16 && centerY < 0.86;
  const fullBodyLikelyVisible = bounds.minY > -0.08 && bounds.maxY < 1.08 && bounds.minX > -0.08 && bounds.maxX < 1.08;
  const enoughLandmarks = visibleLandmarks >= MIN_VISIBLE_LANDMARKS;
  const enoughVisibility = averageVisibility >= MIN_AVERAGE_VISIBILITY;
  const frameQualityOk = enoughLandmarks && enoughVisibility && centered && fullBodyLikelyVisible;
  const stableFrames = frameQualityOk ? Math.min(previousStableFrames + 1, CALIBRATION_STABLE_FRAMES) : 0;
  const stable = stableFrames >= CALIBRATION_STABLE_FRAMES;
  let issue: string | null = null;

  if (!enoughLandmarks || !fullBodyLikelyVisible) issue = 'full_body_required';
  else if (!centered) issue = 'keep_body_in_frame';
  else if (!enoughVisibility) issue = 'improve_lighting';
  else if (!stable) issue = 'hold_still';

  return {
    visibleLandmarks,
    averageVisibility: Math.round(averageVisibility * 100),
    centered,
    stableFrames,
    stable,
    usable: frameQualityOk && stable,
    issue,
  };
}

function makeVideoConstraints(nextFacingMode: 'user' | 'environment', nextDeviceId: string, includeFrameRate = true): MediaTrackConstraints {
  const base: MediaTrackConstraints = nextDeviceId !== 'default'
    ? { deviceId: { exact: nextDeviceId } }
    : { facingMode: { ideal: nextFacingMode } };
  return {
    ...base,
    width: { ideal: 1280 },
    height: { ideal: 720 },
    ...(includeFrameRate ? { frameRate: { ideal: 30, max: 30 } } : {}),
  };
}

const cueCopy: Record<string, { en: string; ar: string }> = {
  basic_tracking: {
    en: 'Pose tracking is active. Keep your full body visible and move with control.',
    ar: 'التتبع شغال. خلي جسمك كامل واضح وتحرك بهدوء.',
  },
  low_pose_confidence: {
    en: 'Improve lighting and keep the working joints visible.',
    ar: 'زيد الإضاءة شوي وخلي المفاصل واضحة.',
  },
  unsupported_exercise: {
    en: 'I can see your body, but this exercise has visibility tracking only.',
    ar: 'شايف جسمك، بس هالتمرين تتبعه عام بدون تصحيح تفصيلي.',
  },
  pose_model_unavailable: {
    en: 'Pose analysis could not load. Refresh the page and try again.',
    ar: 'تحليل الحركة ما اشتغل. حدث الصفحة وجرب مرة ثانية.',
  },
  pose_detection_unavailable: {
    en: 'Pose tracking stopped. Restart the camera session.',
    ar: 'تتبع الحركة وقف. شغل الكاميرا من جديد.',
  },
  step_into_frame: {
    en: 'Step into the frame.',
    ar: 'ادخل قدام الكاميرا.',
  },
  full_body_required: {
    en: 'Step back until your full body is visible.',
    ar: 'ارجع شوي لورا عشان جسمك يبين كامل.',
  },
  keep_body_in_frame: {
    en: 'Keep your body inside the frame.',
    ar: 'خليك داخل إطار الكاميرا.',
  },
  improve_lighting: {
    en: 'Improve lighting.',
    ar: 'زيد الإضاءة شوي.',
  },
  hold_still: {
    en: 'Hold steady for a moment so I can calibrate.',
    ar: 'اثبت لحظة عشان أظبط التتبع.',
  },
  face_camera: {
    en: 'Face the camera.',
    ar: 'واجه الكاميرا.',
  },
  form_good: {
    en: 'Good form. Keep going.',
    ar: 'أداؤك ممتاز، كمل.',
  },
  raise_hips: {
    en: 'Raise your hips slightly.',
    ar: 'ارفع الحوض شوي.',
  },
  lower_hips: {
    en: 'Lower your hips slightly.',
    ar: 'نزل الحوض شوي.',
  },
  open_elbows: {
    en: 'Open your elbow angle.',
    ar: 'افتح زاوية الكوع شوي.',
  },
  chest_up: {
    en: 'Lift your chest.',
    ar: 'ارفع صدرك.',
  },
  lower_squat: {
    en: 'Bend your knees and lower.',
    ar: 'اثني ركبتك وانزل شوي.',
  },
  squat_too_deep: {
    en: 'Rise slightly.',
    ar: 'اطلع شوي لفوق.',
  },
  lower_lunge: {
    en: 'Lower into the lunge.',
    ar: 'انزل أكثر باللانج.',
  },
  shorten_lunge: {
    en: 'Shorten your stance slightly.',
    ar: 'قرب رجليك شوي.',
  },
  bend_back_knee: {
    en: 'Bend your back knee.',
    ar: 'اثني الركبة الخلفية.',
  },
};

function cueFromKey(key: string, severity: CueSeverity, speak = true): CoachingCue {
  const copy = cueCopy[key] ?? cueCopy.step_into_frame;
  return { key, severity, en: copy.en, ar: copy.ar, speak };
}

function severityFromFeedback(feedback: PoseFeedback): CueSeverity {
  if (feedback.status === 'waiting_for_body') return 'camera-setup';
  if (feedback.level === 'good') return 'good';
  if (feedback.level === 'adjust') return 'correction';
  return 'caution';
}

function createCoachingCue(
  feedback: PoseFeedback,
  poseQuality: PoseQuality,
  trackingSupport: ExerciseTrackingConfig['support'] | undefined,
  modelState: 'loading' | 'ready' | 'error',
  liveReady: boolean
): CoachingCue {
  if (modelState === 'error') return cueFromKey(feedback.message, 'camera-setup');
  if (!liveReady || modelState === 'loading') {
    return {
      key: 'camera_idle',
      severity: 'camera-setup',
      en: 'Start the camera and stand where your full body is visible.',
      ar: 'شغل الكاميرا ووقف بمكان يبين جسمك كامل.',
      speak: false,
    };
  }
  if (!poseQuality.usable && poseQuality.issue) return cueFromKey(poseQuality.issue, 'camera-setup');
  if (trackingSupport === 'basic') return cueFromKey('basic_tracking', 'caution', false);
  if (trackingSupport === 'unsupported') return cueFromKey('unsupported_exercise', 'camera-setup', false);
  return cueFromKey(feedback.message, severityFromFeedback(feedback));
}

function pickSpeechVoice(voices: SpeechSynthesisVoice[], language: string) {
  if (language === 'ar') {
    return voices.find((voice) => /^ar(-|_|$)/i.test(voice.lang))
      ?? voices.find((voice) => /arabic|عربي/i.test(voice.name))
      ?? null;
  }
  return voices.find((voice) => /^en(-|_|$)/i.test(voice.lang)) ?? null;
}

export function LiveCoachPage() {
  const { language } = useLanguage();
  const { profile } = useUser();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const animationRef = useRef<number | null>(null);
  const lastInferenceRef = useRef(0);
  const feedbackCandidateRef = useRef({ key: '', frames: 0 });
  const smoothedLandmarksRef = useRef<NormalizedLandmark[] | null>(null);
  const poseQualityRef = useRef<PoseQuality>(emptyPoseQuality());
  const lastSpokenCueRef = useRef({ key: '', time: 0 });
  const progressRef = useRef({ analyzedSamples: 0, goodSamples: 0, corrections: {} as Record<string, number> });
  const liveExercises = useMemo(() => exerciseCatalog.map(toLiveExercise), []);
  const defaultExercise = liveExercises.find((item) => item.tracking.support === 'full') ?? liveExercises[0];
  const routeState = location.state as LiveCoachRouteState | null;
  const requestedExerciseId = searchParams.get('exerciseId') || searchParams.get('exercise') || routeState?.exerciseId || '';
  const requestedExerciseName = searchParams.get('exerciseName') || routeState?.exerciseName || '';
  const requestedExercise = useMemo(() => {
    const requestedId = requestedExerciseId.trim();
    if (requestedId) {
      const byId = liveExercises.find((item) => item.id === requestedId);
      if (byId) return byId;
    }

    const requestedName = normalizeExerciseName(requestedExerciseName);
    if (!requestedName) return null;
    return liveExercises.find((item) =>
      normalizeExerciseName(item.name) === requestedName ||
      normalizeExerciseName(item.nameAr) === requestedName
    ) ?? null;
  }, [liveExercises, requestedExerciseId, requestedExerciseName]);
  const initialExercise = requestedExercise ?? defaultExercise;
  const [cameraState, setCameraState] = useState<CameraState>('idle');
  const [cameraIssue, setCameraIssue] = useState<CameraIssue>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('default');
  const [exercise, setExercise] = useState(initialExercise?.id ?? 'plank');
  const [difficulty, setDifficulty] = useState<DifficultyLevel>(initialExercise?.difficulty ?? 'normal');
  const [exerciseQuery, setExerciseQuery] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [bodyDetected, setBodyDetected] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [modelState, setModelState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [poseQuality, setPoseQuality] = useState<PoseQuality>(() => emptyPoseQuality());
  const [poseFeedback, setPoseFeedback] = useState<PoseFeedback>(() => createPoseFeedback());
  const [voiceEnabled, setVoiceEnabled] = useState(false);

  const text = useCallback((en: string, ar: string) => (language === 'ar' ? ar : en), [language]);
  const isArabic = language === 'ar';
  const selectedExercise = useMemo(
    () => liveExercises.find((item) => item.id === exercise) ?? defaultExercise,
    [defaultExercise, exercise, liveExercises]
  );
  const selectedExerciseLabel = selectedExercise
    ? localizedLabel(selectedExercise.name, selectedExercise.nameAr, language)
    : text('Exercise', 'التمرين');
  const selectedTracking = selectedExercise?.tracking ?? null;
  const supportedPose = selectedTracking?.support === 'full' ? selectedTracking.pose : null;
  const canStartSession = selectedTracking?.support !== 'unsupported';
  const filteredExercises = useMemo(() => {
    const query = exerciseQuery.trim().toLowerCase();
    return liveExercises
      .filter((item) => item.difficulty === difficulty)
      .filter((item) => {
        if (!query) return true;
        return `${item.name} ${item.nameAr} ${item.source.muscle}`.toLowerCase().includes(query);
      })
      .slice(0, 42);
  }, [difficulty, exerciseQuery, liveExercises]);

  const stopCamera = useCallback(() => {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraState('idle');
    setCameraIssue(null);
    setElapsed(0);
    setIsPaused(false);
    setBodyDetected(false);
    poseQualityRef.current = emptyPoseQuality();
    setPoseQuality(poseQualityRef.current);
    smoothedLandmarksRef.current = null;
    setPoseFeedback(createPoseFeedback());
  }, []);

  const resetSession = useCallback(() => {
    progressRef.current = { analyzedSamples: 0, goodSamples: 0, corrections: {} };
    feedbackCandidateRef.current = { key: '', frames: 0 };
    smoothedLandmarksRef.current = null;
    setElapsed(0);
    setBodyDetected(false);
    poseQualityRef.current = emptyPoseQuality();
    setPoseQuality(poseQualityRef.current);
    setPoseFeedback(createPoseFeedback());
  }, []);

  const refreshDevices = useCallback(async () => {
    const available = await navigator.mediaDevices.enumerateDevices();
    setDevices(available.filter((device) => device.kind === 'videoinput'));
  }, []);

  const startCamera = useCallback(async (nextFacingMode = facingMode, nextDeviceId = deviceId) => {
    if (!canStartSession) {
      setCameraIssue('unsupported');
      setErrorMessage(selectedTracking?.reason ?? text('This exercise is not supported for camera tracking yet.', 'هذا التمرين غير مدعوم لتتبع الكاميرا حالياً.'));
      setCameraState('error');
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraIssue('unsupported');
      setErrorMessage(text('This browser does not support camera access.', 'هذا المتصفح لا يدعم الوصول إلى الكاميرا.'));
      setCameraState('error');
      return;
    }

    const isNewSession = !streamRef.current;
    if (isNewSession) progressRef.current = { analyzedSamples: 0, goodSamples: 0, corrections: {} };
    setCameraState('starting');
    setCameraIssue(null);
    setIsPaused(false);
    setBodyDetected(false);
    poseQualityRef.current = emptyPoseQuality();
    setPoseQuality(poseQualityRef.current);
    setErrorMessage('');
    streamRef.current?.getTracks().forEach((track) => track.stop());

    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: makeVideoConstraints(nextFacingMode, nextDeviceId, true),
          audio: false,
        });
      } catch (constraintError) {
        console.warn('Live Coach camera rejected 30fps preference; retrying without frame-rate constraint.', constraintError);
        stream = await navigator.mediaDevices.getUserMedia({
          video: makeVideoConstraints(nextFacingMode, nextDeviceId, false),
          audio: false,
        });
      }
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
      const missing = error instanceof DOMException && (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError');
      setCameraIssue(denied ? 'permission-denied' : missing ? 'no-camera' : 'unknown');
      setErrorMessage(denied
        ? text('Camera permission was denied.', 'تم رفض إذن الكاميرا.')
        : missing
          ? text('No camera was found on this device.', 'لم يتم العثور على كاميرا على هذا الجهاز.')
        : text('The camera could not be started.', 'تعذر تشغيل الكاميرا.'));
      setCameraState('error');
    }
  }, [canStartSession, deviceId, facingMode, refreshDevices, selectedTracking?.reason, text]);

  const switchCamera = async () => {
    const next = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(next);
    setDeviceId('default');
    await startCamera(next, 'default');
  };

  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      setModelState('loading');
      try {
        const vision = await FilesetResolver.forVisionTasks(POSE_WASM_PATH);
        let landmarker: PoseLandmarker;
        try {
          landmarker = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: POSE_MODEL_PATH, delegate: 'GPU' },
            runningMode: 'VIDEO',
            numPoses: 1,
            minPoseDetectionConfidence: 0.55,
            minPosePresenceConfidence: 0.55,
            minTrackingConfidence: 0.55,
          });
        } catch (gpuError) {
          console.warn('Live Coach pose model GPU initialization failed; retrying on CPU.', gpuError);
          landmarker = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: POSE_MODEL_PATH, delegate: 'CPU' },
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
      } catch (error) {
        console.error('Live Coach pose model failed to load.', error);
        if (!cancelled) {
          setModelState('error');
          setPoseFeedback(createPoseFeedback('pose_model_unavailable'));
        }
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
    if (cameraState !== 'live' || modelState !== 'ready' || isPaused) return;

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
          let result: ReturnType<PoseLandmarker['detectForVideo']>;
          try {
            result = landmarker.detectForVideo(video, now);
          } catch (error) {
            console.error('Live Coach pose detection loop failed.', error);
            setModelState('error');
            setBodyDetected(false);
            setPoseFeedback(createPoseFeedback('pose_detection_unavailable'));
            if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
            animationRef.current = null;
            return;
          }
          const landmarks = result.landmarks[0] ?? null;
          const smoothedLandmarks = landmarks ? smoothLandmarks(smoothedLandmarksRef.current, landmarks) : null;
          smoothedLandmarksRef.current = smoothedLandmarks;
          const quality = assessLandmarkQuality(smoothedLandmarks, poseQualityRef.current.stableFrames);
          poseQualityRef.current = quality;
          setPoseQuality(quality);
          setBodyDetected(Boolean(smoothedLandmarks));
          if (smoothedLandmarks) {
            const drawing = new DrawingUtils(context);
            drawing.drawConnectors(smoothedLandmarks, PoseLandmarker.POSE_CONNECTIONS, { color: quality.usable ? '#67e8f9' : '#93c5fd', lineWidth: 3 });
            drawing.drawLandmarks(smoothedLandmarks, { color: '#ffffff', fillColor: quality.usable ? '#22c55e' : '#60a5fa', lineWidth: 1.4, radius: 3.4 });
          }

          const trackingSupport = selectedTracking?.support ?? 'unsupported';
          const nextFeedback = smoothedLandmarks && !quality.usable
            ? createPoseFeedback(quality.issue ?? 'step_into_frame', estimatePoseConfidence(smoothedLandmarks), 'basic')
            : smoothedLandmarks && supportedPose
              ? assessPose(supportedPose, smoothedLandmarks)
              : smoothedLandmarks && trackingSupport === 'basic'
                ? createPoseFeedback('basic_tracking', estimatePoseConfidence(smoothedLandmarks), 'basic')
                : createPoseFeedback(smoothedLandmarks ? 'unsupported_exercise' : 'step_into_frame', smoothedLandmarks ? estimatePoseConfidence(smoothedLandmarks) : 0, 'basic');
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
  }, [cameraState, isPaused, modelState, selectedTracking?.support, supportedPose]);

  useEffect(() => {
    resetSession();
  }, [exercise, resetSession]);

  const getSessionContext = useCallback((): LiveSessionContext => {
    const progress = progressRef.current;
    const cue = feedbackCopy[poseFeedback.message]?.[0] || poseFeedback.message;
    return {
      exercise: selectedExercise?.name ?? exercise,
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
  }, [cameraState, elapsed, exercise, modelState, poseFeedback, selectedExercise?.name]);

  useEffect(() => {
    if (cameraState !== 'live' || isPaused) return;
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [cameraState, isPaused]);

  useEffect(() => stopCamera, [stopCamera]);

  useEffect(() => {
    if (!requestedExercise) return;
    setDifficulty(requestedExercise.difficulty);
    setExercise(requestedExercise.id);
  }, [requestedExercise]);

  useEffect(() => {
    if (filteredExercises.length > 0 && !filteredExercises.some((item) => item.id === exercise)) {
      setExercise(filteredExercises[0].id);
    }
  }, [exercise, filteredExercises]);

  const liveReady = cameraState === 'live';
  const trackingReady = modelState === 'ready';
  const analysisActive = liveReady && trackingReady && !isPaused;
  const bodyNotDetected = liveReady && trackingReady && !bodyDetected;
  const coachingCue = createCoachingCue(poseFeedback, poseQuality, selectedTracking?.support, modelState, liveReady);
  const needsVisibilityAdjustment = ['full_body_required', 'step_into_frame', 'low_pose_confidence', 'keep_body_in_frame', 'improve_lighting', 'hold_still'].includes(poseFeedback.message);
  const confidenceLabel = poseFeedback.confidence > 0
    ? `${poseFeedback.confidence}%`
    : bodyDetected
      ? text('Pose visible', 'الوضعية ظاهرة')
      : text('Waiting for body', 'بانتظار ظهور الجسم');
  const supportLabel = supportedPose
    ? poseFeedback.supportLevel === 'full'
      ? text('Full analysis', 'تحليل كامل')
      : text('Basic tracking', 'تتبع أساسي')
    : text('Preview only', 'عرض فقط');
  const trackingSupportLabel = selectedTracking?.support === 'full'
    ? text('Full analysis', 'تحليل كامل')
    : selectedTracking?.support === 'basic'
      ? text('Basic tracking', 'تتبع أساسي')
      : text('Not supported', 'غير مدعوم');
  const trackedRatio = progressRef.current.analyzedSamples
    ? `${Math.round((progressRef.current.goodSamples / progressRef.current.analyzedSamples) * 100)}%`
    : text('Collecting', 'قيد الجمع');

  const guidanceItems = [
    { label: text('Full body visible', 'ظهور الجسم كاملًا'), active: !needsVisibilityAdjustment },
    { label: text('Good lighting', 'إضاءة جيدة'), active: liveReady },
    { label: text('Camera stable', 'ثبات الكاميرا'), active: liveReady },
    { label: text('Exercise selected', 'تم اختيار التمرين'), active: Boolean(exercise) },
  ];

  const setupGuidanceItems = [
    { label: text('Full body visible', 'ظهور الجسم كامل'), active: bodyDetected && poseQuality.visibleLandmarks >= MIN_VISIBLE_LANDMARKS },
    { label: text('Good lighting', 'إضاءة واضحة'), active: poseQuality.averageVisibility >= Math.round(MIN_AVERAGE_VISIBILITY * 100) },
    { label: text('Body centered', 'جسمك بوسط الكاميرا'), active: poseQuality.centered },
    { label: text('Stable detection', 'التتبع ثابت'), active: poseQuality.stable },
    { label: text('Exercise selected', 'تم اختيار التمرين'), active: Boolean(exercise) },
  ];

  useEffect(() => {
    if (!voiceEnabled || !coachingCue.speak || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const now = Date.now();
    if (lastSpokenCueRef.current.key === coachingCue.key && now - lastSpokenCueRef.current.time < VOICE_COOLDOWN_MS) return;

    const speak = () => {
      const voices = window.speechSynthesis.getVoices();
      const utterance = new SpeechSynthesisUtterance(isArabic ? coachingCue.ar : coachingCue.en);
      const voice = pickSpeechVoice(voices, language);
      if (voice) utterance.voice = voice;
      utterance.lang = isArabic ? (voice?.lang || 'ar-JO') : (voice?.lang || 'en-US');
      utterance.rate = 0.94;
      utterance.volume = 0.9;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
      lastSpokenCueRef.current = { key: coachingCue.key, time: now };
    };

    if (window.speechSynthesis.getVoices().length > 0) {
      speak();
      return;
    }

    const handleVoicesChanged = () => speak();
    window.speechSynthesis.addEventListener('voiceschanged', handleVoicesChanged, { once: true });
    return () => window.speechSynthesis.removeEventListener('voiceschanged', handleVoicesChanged);
  }, [coachingCue, isArabic, language, voiceEnabled]);

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
                {setupGuidanceItems.map((item) => (
                  <div key={item.label} className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2.5 text-sm">
                    <span className="text-foreground/90">{item.label}</span>
                    <span className={cn('rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em]', item.active ? 'bg-emerald-400/12 text-emerald-200' : 'bg-white/6 text-muted-foreground')}>
                      {item.active ? text('OK', 'جاهز') : text('Guide', 'تنبيه')}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <InfoChip label={text('Difficulty', 'المستوى')} value={difficulty === 'advanced' ? text('Advanced', 'متقدم') : text('Normal', 'عادي')} />
                <InfoChip label={text('Analysis', 'التحليل')} value={trackingSupportLabel} />
                <InfoChip label={text('Confidence', 'الثقة')} value={confidenceLabel} />
                <InfoChip label={text('Reps', 'التكرارات')} value={text('Pending', 'لاحقاً')} />
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
                {cameraState === 'live' && (
                  <CoachingCueOverlay
                    cue={coachingCue}
                    isArabic={isArabic}
                    poseQuality={poseQuality}
                    text={text}
                  />
                )}

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
                      <Button onClick={() => startCamera()} className="rounded-full px-6" disabled={cameraState === 'starting' || !canStartSession}>
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
                      <Button variant="secondary" onClick={() => setIsPaused((value) => !value)} className="rounded-full border border-white/10 bg-white/[0.06] px-5">
                        {isPaused ? <Play className="mr-2 h-4 w-4" /> : <Pause className="mr-2 h-4 w-4" />}
                        {isPaused ? text('Resume', 'استئناف') : text('Pause', 'إيقاف مؤقت')}
                      </Button>
                      <Button variant="secondary" onClick={resetSession} className="rounded-full border border-white/10 bg-white/[0.06] px-5"><RotateCcw className="mr-2 h-4 w-4" />{text('Reset', 'إعادة ضبط')}</Button>
                      <Button variant="destructive" onClick={stopCamera} className="rounded-full px-5 shadow-[0_16px_36px_rgba(239,68,68,0.22)]"><CameraOff className="mr-2 h-4 w-4" />{text('Stop Session', 'إيقاف الجلسة')}</Button>
                      <Button variant="secondary" onClick={switchCamera} className="rounded-full border border-white/10 bg-white/[0.06] px-5"><RefreshCw className="mr-2 h-4 w-4" />{text('Switch camera', 'تبديل الكاميرا')}</Button>
                      <Button variant="secondary" onClick={() => setVoiceEnabled((value) => !value)} className="rounded-full border border-white/10 bg-white/[0.06] px-5">
                        {voiceEnabled ? <Volume2 className="mr-2 h-4 w-4" /> : <VolumeX className="mr-2 h-4 w-4" />}
                        {voiceEnabled ? text('Voice on', 'الصوت شغال') : text('Muted', 'الصوت مطفي')}
                      </Button>
                    </>
                  ) : (
                    <Button onClick={() => startCamera()} disabled={cameraState === 'starting' || !canStartSession} className="rounded-full px-6"><Camera className="mr-2 h-4 w-4" />{text('Start camera', 'تشغيل الكاميرا')}</Button>
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
              <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">{text('Tracking', 'التتبع')}</span>
                  <span className={cn(
                    'rounded-full px-2.5 py-1 text-[11px] font-semibold',
                    selectedTracking?.support === 'full' && 'bg-emerald-400/12 text-emerald-200',
                    selectedTracking?.support === 'basic' && 'bg-cyan-400/12 text-cyan-100',
                    selectedTracking?.support === 'unsupported' && 'bg-amber-400/12 text-amber-200'
                  )}>
                    {trackingSupportLabel}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-6 text-muted-foreground">
                  {selectedTracking?.reason ?? text('Select an exercise to see tracking support.', 'اختر تمريناً لعرض دعم التتبع.')}
                </p>
              </div>
              <div className="mt-3 grid grid-cols-2 rounded-2xl border border-white/10 bg-black/20 p-1">
                {(['normal', 'advanced'] as const).map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setDifficulty(level)}
                    className={cn(
                      'rounded-xl px-3 py-2 text-sm font-semibold transition',
                      difficulty === level ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {level === 'advanced' ? text('Advanced', 'متقدم') : text('Normal', 'عادي')}
                  </button>
                ))}
              </div>

              <div className="relative mt-3">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={exerciseQuery}
                  onChange={(event) => setExerciseQuery(event.target.value)}
                  placeholder={text('Search exercises', 'ابحث عن تمرين')}
                  className="h-11 w-full rounded-2xl border border-white/10 bg-black/20 pl-10 pr-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-cyan-300/40"
                />
              </div>

              <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
                {filteredExercises.map((item) => {
                  const active = item.id === exercise;
                  const label = localizedLabel(item.name, item.nameAr, language);
                  const itemSupportLabel = item.tracking.support === 'full'
                    ? text('Full analysis', 'تحليل كامل')
                    : item.tracking.support === 'basic'
                      ? text('Basic tracking', 'تتبع أساسي')
                      : text('Not supported', 'غير مدعوم');
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setExercise(item.id)}
                      className={cn(
                        'w-full rounded-2xl border px-3 py-3 text-left transition',
                        active ? 'border-cyan-300/35 bg-cyan-400/10' : 'border-white/8 bg-white/[0.03] hover:border-white/16 hover:bg-white/[0.06]'
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-white">{label}</div>
                          <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                            <span>{item.source.muscle}</span>
                            <span>•</span>
                            <span>{item.source.location}</span>
                            <span>•</span>
                            <span className={cn(
                              'rounded-full px-2 py-0.5',
                              item.tracking.support === 'full' && 'bg-emerald-400/10 text-emerald-200',
                              item.tracking.support === 'basic' && 'bg-cyan-400/10 text-cyan-100',
                              item.tracking.support === 'unsupported' && 'bg-amber-400/10 text-amber-200'
                            )}>{itemSupportLabel}</span>
                          </div>
                        </div>
                        {active && <CheckCircle2 className="h-4 w-4 shrink-0 text-cyan-200" />}
                      </div>
                    </button>
                  );
                })}
                {filteredExercises.length === 0 && (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-muted-foreground">
                    {text('No exercises match this filter.', 'لا توجد تمارين مطابقة لهذا الفلتر.')}
                  </div>
                )}
              </div>
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
  basic_tracking: ['Pose tracking is active. Keep your body visible and move with control.', 'تتبع الوضعية فعّال. أبقِ جسمك ظاهراً وتحرك بتحكم.'],
  low_pose_confidence: ['Improve lighting and keep the working joints visible', 'حسّن الإضاءة وأظهر المفاصل المطلوبة'],
  unsupported_exercise: ['Pose visibility is active. Detailed scoring is not available for this exercise yet.', 'رؤية الوضعية فعالة. التقييم التفصيلي غير متاح لهذا التمرين حالياً.'],
  pose_model_unavailable: ['Pose analysis could not load. Check the model assets and refresh.', 'تعذر تحميل تحليل الحركة. تحقق من ملفات النموذج ثم حدّث الصفحة.'],
  pose_detection_unavailable: ['Pose tracking stopped. Refresh the camera session and try again.', 'توقف تتبع الحركة. أعد تشغيل جلسة الكاميرا وحاول مرة أخرى.'],
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

function CoachingCueOverlay({ cue, isArabic, poseQuality, text }: {
  cue: CoachingCue;
  isArabic: boolean;
  poseQuality: PoseQuality;
  text: (en: string, ar: string) => string;
}) {
  const message = isArabic ? cue.ar : cue.en;
  const label = cue.severity === 'good'
    ? text('Good', 'تمام')
    : cue.severity === 'correction'
      ? text('Correct now', 'عدّل الآن')
      : cue.severity === 'caution'
        ? text('Watch it', 'انتبه')
        : text('Camera setup', 'ضبط الكاميرا');
  const Icon = cue.severity === 'good'
    ? CheckCircle2
    : cue.severity === 'correction'
      ? TriangleAlert
      : cue.severity === 'caution'
        ? ShieldCheck
        : Radar;

  return (
    <div className={cn(
      'pointer-events-none absolute inset-x-4 top-4 z-[5] rounded-3xl border px-4 py-3 shadow-[0_18px_60px_rgba(0,0,0,0.35)] backdrop-blur-xl sm:inset-x-8 sm:top-6',
      cue.severity === 'good' && 'border-emerald-300/35 bg-emerald-500/18 text-emerald-50',
      cue.severity === 'caution' && 'border-yellow-300/35 bg-yellow-500/18 text-yellow-50',
      cue.severity === 'correction' && 'border-red-300/40 bg-red-500/20 text-red-50',
      cue.severity === 'camera-setup' && 'border-cyan-300/35 bg-cyan-500/18 text-cyan-50'
    )}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-black/25">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] opacity-80">{label}</div>
          <div className="mt-1 text-lg font-semibold leading-snug sm:text-2xl">{message}</div>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-white/75">
            <span>{text('Visibility', 'الوضوح')}: {poseQuality.averageVisibility}%</span>
            <span>{text('Landmarks', 'النقاط')}: {poseQuality.visibleLandmarks}</span>
            <span>{text('Stable', 'الثبات')}: {poseQuality.stableFrames}/{CALIBRATION_STABLE_FRAMES}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

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
  const phaseLabel = feedback.repPhase
    ? feedback.repPhase === 'hold'
      ? text('Hold', 'ثبات')
      : feedback.repPhase === 'top'
        ? text('Top', 'الأعلى')
        : feedback.repPhase === 'bottom'
          ? text('Bottom', 'الأسفل')
          : text('Transition', 'انتقال')
    : text('Pending', 'لاحقاً');
  const supportLabel = feedback.supportLevel === 'full'
    ? text('Full analysis', 'تحليل كامل')
    : text('Basic tracking', 'تتبع أساسي');
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
        <span className="font-mono text-sm font-semibold">{feedback.confidence}%</span>
      </div>
      <p className="text-sm font-medium leading-7 text-foreground">{message}</p>
      <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
        <InfoChip label={text('Confidence', 'الثقة')} value={`${feedback.confidence}%`} />
        <InfoChip label={text('Score', 'النتيجة')} value={feedback.score !== null ? `${feedback.score}%` : text('Not ready', 'غير جاهز')} />
        <InfoChip label={text('Phase', 'المرحلة')} value={phaseLabel} />
        <InfoChip label={text('Support', 'الدعم')} value={supportLabel} />
      </div>
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

function InfoChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-semibold text-white">{value}</div>
    </div>
  );
}

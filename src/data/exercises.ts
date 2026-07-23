import { repairMojibake } from '@/lib/text';

export interface Exercise {
  id: string;
  name: string;
  nameAr: string;
  muscle: string;
  goal: 'bulking' | 'cutting' | 'fitness' | 'all';
  location: 'home' | 'gym' | 'both';
  gender: 'male' | 'female' | 'all';
  sets: number;
  reps: string;
  description: string;
  descriptionAr: string;
}

const rawExercises: Exercise[] = [
  // ===== CHEST =====
  { id: 'push-ups', name: 'Push-Ups', nameAr: 'تمرين الضغط', muscle: 'chest', goal: 'all', location: 'both', gender: 'all', sets: 3, reps: '12-15', description: 'Classic bodyweight exercise targeting chest, shoulders, and triceps.', descriptionAr: 'تمرين كلاسيكي بوزن الجسم يستهدف الصدر والأكتاف والتراي.' },
  { id: 'bench-press', name: 'Bench Press', nameAr: 'ضغط البنش', muscle: 'chest', goal: 'bulking', location: 'gym', gender: 'all', sets: 4, reps: '8-10', description: 'Compound exercise for building chest mass and strength.', descriptionAr: 'تمرين مركب لبناء كتلة الصدر وقوته.' },
  { id: 'incline-push-ups', name: 'Incline Push-Ups', nameAr: 'ضغط مائل', muscle: 'chest', goal: 'fitness', location: 'home', gender: 'all', sets: 3, reps: '15-20', description: 'Beginner-friendly push-up variation using an elevated surface.', descriptionAr: 'نسخة سهلة من تمرين الضغط باستخدام سطح مرتفع.' },
  { id: 'incline-bench-press', name: 'Incline Bench Press', nameAr: 'ضغط بنش مائل', muscle: 'chest', goal: 'bulking', location: 'gym', gender: 'male', sets: 4, reps: '8-10', description: 'Targets upper chest for a fuller, more balanced chest development.', descriptionAr: 'يستهدف أعلى الصدر لتطوير أكثر توازناً.' },
  { id: 'chest-fly', name: 'Chest Fly', nameAr: 'فلاي الصدر', muscle: 'chest', goal: 'all', location: 'gym', gender: 'all', sets: 3, reps: '10-12', description: 'Isolation exercise that stretches and contracts the chest muscles.', descriptionAr: 'تمرين عزل يمدد ويقبض عضلات الصدر.' },
  { id: 'knee-push-ups', name: 'Knee Push-Ups', nameAr: 'ضغط على الركب', muscle: 'chest', goal: 'fitness', location: 'home', gender: 'female', sets: 3, reps: '12-15', description: 'Modified push-ups for beginners, great for building upper body strength.', descriptionAr: 'تمرين ضغط معدّل للمبتدئين، ممتاز لبناء قوة الجزء العلوي.' },
  { id: 'chest-press-machine', name: 'Chest Press Machine', nameAr: 'آلة ضغط الصدر', muscle: 'chest', goal: 'fitness', location: 'gym', gender: 'female', sets: 3, reps: '12-15', description: 'Machine-guided chest press for controlled movement and toning.', descriptionAr: 'ضغط صدر بالآلة لحركة مضبوطة وتنسيق.' },
  { id: 'decline-bench-press', name: 'Decline Bench Press', nameAr: 'بنش هابط', muscle: 'chest', goal: 'bulking', location: 'gym', gender: 'male', sets: 4, reps: '8-10', description: 'Targets lower chest for complete chest development.', descriptionAr: 'يستهدف أسفل الصدر لتطوير كامل.' },

  // ===== BACK =====
  { id: 'pull-ups', name: 'Pull-Ups', nameAr: 'العقلة', muscle: 'back', goal: 'all', location: 'both', gender: 'all', sets: 3, reps: '8-12', description: 'Excellent compound exercise for back and biceps development.', descriptionAr: 'تمرين مركب ممتاز لتطوير الظهر والباي.' },
  { id: 'bent-over-rows', name: 'Bent Over Rows', nameAr: 'التجديف المائل', muscle: 'back', goal: 'bulking', location: 'gym', gender: 'all', sets: 4, reps: '8-10', description: 'Heavy compound movement for building a thick back.', descriptionAr: 'حركة مركبة ثقيلة لبناء ظهر سميك.' },
  { id: 'superman', name: 'Superman Hold', nameAr: 'تمرين سوبرمان', muscle: 'back', goal: 'fitness', location: 'home', gender: 'all', sets: 3, reps: '30 sec', description: 'Bodyweight exercise for lower back strength.', descriptionAr: 'تمرين بوزن الجسم لقوة أسفل الظهر.' },
  { id: 'lat-pulldown', name: 'Lat Pulldown', nameAr: 'سحب عالي', muscle: 'back', goal: 'all', location: 'gym', gender: 'all', sets: 4, reps: '10-12', description: 'Machine exercise targeting lats for a wider back.', descriptionAr: 'تمرين آلة يستهدف اللاتس لظهر أعرض.' },
  { id: 'seated-cable-row', name: 'Seated Cable Row', nameAr: 'تجديف جالس بالكيبل', muscle: 'back', goal: 'bulking', location: 'gym', gender: 'all', sets: 4, reps: '10-12', description: 'Cable exercise for overall back thickness.', descriptionAr: 'تمرين كيبل لسماكة الظهر.' },
  { id: 'resistance-band-rows', name: 'Resistance Band Rows', nameAr: 'تجديف بالحبل المطاطي', muscle: 'back', goal: 'fitness', location: 'home', gender: 'female', sets: 3, reps: '15-20', description: 'Light resistance exercise for toning the back.', descriptionAr: 'تمرين بمقاومة خفيفة لتنسيق الظهر.' },
  { id: 'single-arm-row', name: 'Single Arm Dumbbell Row', nameAr: 'تجديف ذراع واحدة', muscle: 'back', goal: 'all', location: 'gym', gender: 'all', sets: 3, reps: '10-12', description: 'Unilateral back exercise for balanced development.', descriptionAr: 'تمرين ظهر أحادي لتطوير متوازن.' },

  // ===== SHOULDERS =====
  { id: 'shoulder-press', name: 'Shoulder Press', nameAr: 'ضغط الكتف', muscle: 'shoulders', goal: 'bulking', location: 'gym', gender: 'all', sets: 4, reps: '8-10', description: 'Overhead press for building shoulder mass.', descriptionAr: 'ضغط علوي لبناء كتلة الكتف.' },
  { id: 'pike-push-ups', name: 'Pike Push-Ups', nameAr: 'ضغط الرمح', muscle: 'shoulders', goal: 'fitness', location: 'home', gender: 'all', sets: 3, reps: '10-12', description: 'Bodyweight shoulder exercise mimicking overhead press.', descriptionAr: 'تمرين كتف بوزن الجسم يحاكي الضغط العلوي.' },
  { id: 'lateral-raises', name: 'Lateral Raises', nameAr: 'رفع جانبي', muscle: 'shoulders', goal: 'all', location: 'both', gender: 'all', sets: 3, reps: '12-15', description: 'Isolation exercise for side deltoids.', descriptionAr: 'تمرين عزل للدالية الجانبية.' },
  { id: 'front-raises', name: 'Front Raises', nameAr: 'رفع أمامي', muscle: 'shoulders', goal: 'all', location: 'both', gender: 'all', sets: 3, reps: '12-15', description: 'Targets the front deltoids for balanced shoulder development.', descriptionAr: 'يستهدف الدالية الأمامية لتطوير متوازن للكتف.' },
  { id: 'face-pulls', name: 'Face Pulls', nameAr: 'سحب الوجه', muscle: 'shoulders', goal: 'fitness', location: 'gym', gender: 'all', sets: 3, reps: '15-20', description: 'Excellent for rear delts and rotator cuff health.', descriptionAr: 'ممتاز للدالية الخلفية وصحة الكتف.' },
  { id: 'light-lateral-raises', name: 'Light Lateral Raises', nameAr: 'رفع جانبي خفيف', muscle: 'shoulders', goal: 'cutting', location: 'both', gender: 'female', sets: 3, reps: '15-20', description: 'Light lateral raises for toning shoulders.', descriptionAr: 'رفع جانبي خفيف لتنسيق الأكتاف.' },

  // ===== BICEPS =====
  { id: 'bicep-curls', name: 'Bicep Curls', nameAr: 'كيرل الباي', muscle: 'biceps', goal: 'all', location: 'both', gender: 'all', sets: 3, reps: '10-12', description: 'Classic isolation exercise for biceps.', descriptionAr: 'تمرين عزل كلاسيكي للباي.' },
  { id: 'chin-ups', name: 'Chin-Ups', nameAr: 'سحب بقبضة معكوسة', muscle: 'biceps', goal: 'bulking', location: 'both', gender: 'all', sets: 3, reps: '8-10', description: 'Compound exercise emphasizing biceps with back involvement.', descriptionAr: 'تمرين مركب يركز على الباي مع إشراك الظهر.' },
  { id: 'hammer-curls', name: 'Hammer Curls', nameAr: 'كيرل المطرقة', muscle: 'biceps', goal: 'bulking', location: 'both', gender: 'all', sets: 3, reps: '10-12', description: 'Targets brachialis and forearms along with biceps.', descriptionAr: 'يستهدف العضلة العضدية والساعد مع الباي.' },
  { id: 'concentration-curls', name: 'Concentration Curls', nameAr: 'كيرل التركيز', muscle: 'biceps', goal: 'cutting', location: 'both', gender: 'all', sets: 3, reps: '12-15', description: 'Isolated bicep exercise for peak contraction.', descriptionAr: 'تمرين عزل للباي لأقصى انقباض.' },
  { id: 'light-bicep-curls', name: 'Light Dumbbell Curls', nameAr: 'كيرل خفيف', muscle: 'biceps', goal: 'fitness', location: 'both', gender: 'female', sets: 3, reps: '15-20', description: 'Light curls for toning arms without bulking.', descriptionAr: 'كيرل خفيف لتنسيق الذراعين بدون تضخيم.' },

  // ===== TRICEPS =====
  { id: 'tricep-dips', name: 'Tricep Dips', nameAr: 'انخفاضات التراي', muscle: 'triceps', goal: 'all', location: 'both', gender: 'all', sets: 3, reps: '10-12', description: 'Bodyweight exercise for triceps using a bench or chair.', descriptionAr: 'تمرين بوزن الجسم للتراي باستخدام مقعد أو كرسي.' },
  { id: 'diamond-push-ups', name: 'Diamond Push-Ups', nameAr: 'ضغط الماسة', muscle: 'triceps', goal: 'fitness', location: 'home', gender: 'all', sets: 3, reps: '10-12', description: 'Push-up variation targeting triceps with hands close together.', descriptionAr: 'نسخة من تمرين الضغط تستهدف التراي بالأيدي متقاربة.' },
  { id: 'tricep-pushdown', name: 'Tricep Pushdown', nameAr: 'دفع تراي بالكيبل', muscle: 'triceps', goal: 'all', location: 'gym', gender: 'all', sets: 3, reps: '10-12', description: 'Cable exercise isolating the triceps effectively.', descriptionAr: 'تمرين كيبل لعزل التراي بفعالية.' },
  { id: 'overhead-tricep-extension', name: 'Overhead Tricep Extension', nameAr: 'تمديد التراي العلوي', muscle: 'triceps', goal: 'bulking', location: 'both', gender: 'all', sets: 3, reps: '10-12', description: 'Stretches and targets the long head of the triceps.', descriptionAr: 'يمدد ويستهدف الرأس الطويل للتراي.' },
  { id: 'tricep-kickback', name: 'Tricep Kickback', nameAr: 'ركلة تراي خلفية', muscle: 'triceps', goal: 'cutting', location: 'both', gender: 'female', sets: 3, reps: '12-15', description: 'Isolation exercise for toning the back of the arms.', descriptionAr: 'تمرين عزل لتنسيق خلف الذراع.' },

  // ===== ABS =====
  { id: 'plank', name: 'Plank', nameAr: 'البلانك', muscle: 'abs', goal: 'all', location: 'both', gender: 'all', sets: 3, reps: '30-60 sec', description: 'Isometric core exercise for overall stability.', descriptionAr: 'تمرين متساوي القياس للجذع للثبات العام.' },
  { id: 'crunches', name: 'Crunches', nameAr: 'الكرانش', muscle: 'abs', goal: 'cutting', location: 'home', gender: 'all', sets: 3, reps: '15-20', description: 'Classic ab exercise targeting rectus abdominis.', descriptionAr: 'تمرين بطن كلاسيكي يستهدف العضلة المستقيمة البطنية.' },
  { id: 'leg-raises', name: 'Leg Raises', nameAr: 'رفع الأرجل', muscle: 'abs', goal: 'all', location: 'both', gender: 'all', sets: 3, reps: '12-15', description: 'Lower ab exercise hanging or lying down.', descriptionAr: 'تمرين أسفل البطن معلقاً أو مستلقياً.' },
  { id: 'mountain-climbers', name: 'Mountain Climbers', nameAr: 'تسلق الجبل', muscle: 'abs', goal: 'cutting', location: 'home', gender: 'all', sets: 3, reps: '30 sec', description: 'Dynamic core and cardio exercise for fat burning.', descriptionAr: 'تمرين ديناميكي للجذع والقلب لحرق الدهون.' },
  { id: 'russian-twists', name: 'Russian Twists', nameAr: 'اللف الروسي', muscle: 'abs', goal: 'fitness', location: 'home', gender: 'all', sets: 3, reps: '20 each', description: 'Rotational exercise targeting obliques and core.', descriptionAr: 'تمرين دوراني يستهدف العضلات المائلة والجذع.' },
  { id: 'cable-crunches', name: 'Cable Crunches', nameAr: 'كرانش بالكيبل', muscle: 'abs', goal: 'bulking', location: 'gym', gender: 'all', sets: 3, reps: '12-15', description: 'Weighted ab exercise for building thicker abs.', descriptionAr: 'تمرين بطن بالأوزان لبناء بطن أقوى.' },
  { id: 'bicycle-crunches', name: 'Bicycle Crunches', nameAr: 'كرانش الدراجة', muscle: 'abs', goal: 'cutting', location: 'home', gender: 'female', sets: 3, reps: '20 each', description: 'Great for waist definition and oblique toning.', descriptionAr: 'ممتاز لنحت الخصر وتنسيق العضلات المائلة.' },
  { id: 'dead-bug', name: 'Dead Bug', nameAr: 'الحشرة الميتة', muscle: 'abs', goal: 'fitness', location: 'home', gender: 'female', sets: 3, reps: '10 each', description: 'Core stability exercise great for beginners.', descriptionAr: 'تمرين ثبات الجذع ممتاز للمبتدئين.' },

  // ===== QUADS =====
  { id: 'squats', name: 'Squats', nameAr: 'السكوات', muscle: 'quads', goal: 'all', location: 'both', gender: 'all', sets: 4, reps: '10-12', description: 'King of leg exercises for overall lower body development.', descriptionAr: 'ملك تمارين الأرجل لتطوير الجزء السفلي بالكامل.' },
  { id: 'leg-press', name: 'Leg Press', nameAr: 'ضغط الأرجل', muscle: 'quads', goal: 'bulking', location: 'gym', gender: 'all', sets: 4, reps: '10-12', description: 'Machine exercise for quad development with back support.', descriptionAr: 'تمرين آلة لتطوير الفخذ الأمامي مع دعم الظهر.' },
  { id: 'lunges', name: 'Lunges', nameAr: 'اللانج', muscle: 'quads', goal: 'fitness', location: 'home', gender: 'all', sets: 3, reps: '12 each', description: 'Unilateral leg exercise for balance and quad strength.', descriptionAr: 'تمرين ساق أحادي للتوازن وقوة الفخذ.' },
  { id: 'bulgarian-split-squats', name: 'Bulgarian Split Squats', nameAr: 'سكوات بلغاري', muscle: 'quads', goal: 'all', location: 'both', gender: 'all', sets: 3, reps: '10 each', description: 'Single-leg exercise for quad strength and balance.', descriptionAr: 'تمرين ساق واحدة لقوة الفخذ والتوازن.' },
  { id: 'leg-extensions', name: 'Leg Extensions', nameAr: 'تمديد الأرجل', muscle: 'quads', goal: 'cutting', location: 'gym', gender: 'all', sets: 3, reps: '12-15', description: 'Isolation exercise targeting the quadriceps.', descriptionAr: 'تمرين عزل يستهدف الفخذ الأمامي.' },
  { id: 'goblet-squats', name: 'Goblet Squats', nameAr: 'سكوات الكأس', muscle: 'quads', goal: 'fitness', location: 'both', gender: 'female', sets: 3, reps: '12-15', description: 'Beginner-friendly squat variation with a dumbbell.', descriptionAr: 'سكوات سهل للمبتدئين مع دمبل.' },
  { id: 'wall-sit', name: 'Wall Sit', nameAr: 'الجلوس على الحائط', muscle: 'quads', goal: 'fitness', location: 'home', gender: 'all', sets: 3, reps: '30-45 sec', description: 'Isometric exercise for quad endurance.', descriptionAr: 'تمرين متساوي القياس لتحمل الفخذ.' },

  // ===== HAMSTRINGS =====
  { id: 'romanian-deadlift', name: 'Romanian Deadlift', nameAr: 'الرفعة الرومانية', muscle: 'hamstrings', goal: 'bulking', location: 'gym', gender: 'all', sets: 4, reps: '8-10', description: 'Hip hinge movement for hamstring and glute development.', descriptionAr: 'حركة مفصل الورك لتطوير الفخذ الخلفي والمؤخرة.' },
  { id: 'glute-bridge', name: 'Glute Bridge', nameAr: 'جسر الغلوت', muscle: 'hamstrings', goal: 'all', location: 'home', gender: 'all', sets: 3, reps: '15-20', description: 'Bodyweight exercise for glutes and hamstrings.', descriptionAr: 'تمرين بوزن الجسم للمؤخرة والفخذ الخلفي.' },
  { id: 'leg-curls', name: 'Leg Curls', nameAr: 'ثني الأرجل', muscle: 'hamstrings', goal: 'all', location: 'gym', gender: 'all', sets: 3, reps: '10-12', description: 'Machine exercise isolating the hamstrings.', descriptionAr: 'تمرين آلة لعزل الفخذ الخلفي.' },
  { id: 'nordic-curls', name: 'Nordic Curls', nameAr: 'الكيرل النوردي', muscle: 'hamstrings', goal: 'fitness', location: 'home', gender: 'all', sets: 3, reps: '5-8', description: 'Advanced bodyweight exercise for hamstring strength.', descriptionAr: 'تمرين متقدم بوزن الجسم لقوة الفخذ الخلفي.' },
  { id: 'single-leg-bridge', name: 'Single Leg Bridge', nameAr: 'جسر ساق واحدة', muscle: 'hamstrings', goal: 'fitness', location: 'home', gender: 'female', sets: 3, reps: '12 each', description: 'Unilateral glute bridge for balanced hamstring development.', descriptionAr: 'جسر أحادي لتطوير متوازن للفخذ الخلفي.' },

  // ===== GLUTES =====
  { id: 'hip-thrust', name: 'Hip Thrust', nameAr: 'دفع الورك', muscle: 'glutes', goal: 'bulking', location: 'gym', gender: 'all', sets: 4, reps: '10-12', description: 'Best exercise for glute activation and growth.', descriptionAr: 'أفضل تمرين لتفعيل ونمو المؤخرة.' },
  { id: 'donkey-kicks', name: 'Donkey Kicks', nameAr: 'ركلة الحمار', muscle: 'glutes', goal: 'fitness', location: 'home', gender: 'female', sets: 3, reps: '15 each', description: 'Bodyweight glute isolation exercise.', descriptionAr: 'تمرين عزل للمؤخرة بوزن الجسم.' },
  { id: 'fire-hydrants', name: 'Fire Hydrants', nameAr: 'حنفية الحريق', muscle: 'glutes', goal: 'fitness', location: 'home', gender: 'female', sets: 3, reps: '15 each', description: 'Targets hip abductors and glutes for toning.', descriptionAr: 'يستهدف عضلات الورك والمؤخرة للتنشيف.' },
  { id: 'sumo-squats', name: 'Sumo Squats', nameAr: 'سكوات سومو', muscle: 'glutes', goal: 'all', location: 'both', gender: 'all', sets: 3, reps: '12-15', description: 'Wide stance squat emphasizing inner thighs and glutes.', descriptionAr: 'سكوات بقدمين واسعتين يركز على الفخذ الداخلي والمؤخرة.' },
  { id: 'glute-kickback-machine', name: 'Glute Kickback Machine', nameAr: 'آلة ركلة المؤخرة', muscle: 'glutes', goal: 'all', location: 'gym', gender: 'female', sets: 3, reps: '12-15', description: 'Machine isolation for glute shaping and building.', descriptionAr: 'آلة عزل لنحت وبناء المؤخرة.' },
  { id: 'banded-walks', name: 'Banded Lateral Walks', nameAr: 'مشي جانبي بالحبل', muscle: 'glutes', goal: 'fitness', location: 'home', gender: 'female', sets: 3, reps: '15 each', description: 'Resistance band exercise for glute medius activation.', descriptionAr: 'تمرين بحبل مطاطي لتفعيل عضلة الورك.' },
  { id: 'cable-pull-through', name: 'Cable Pull Through', nameAr: 'سحب كيبل من بين الأرجل', muscle: 'glutes', goal: 'bulking', location: 'gym', gender: 'all', sets: 3, reps: '12-15', description: 'Cable exercise targeting glutes and hamstrings.', descriptionAr: 'تمرين كيبل يستهدف المؤخرة والفخذ الخلفي.' },

  // ===== CALVES =====
  { id: 'calf-raises', name: 'Calf Raises', nameAr: 'رفع السمانة', muscle: 'calves', goal: 'all', location: 'both', gender: 'all', sets: 3, reps: '15-20', description: 'Simple but effective exercise for calf development.', descriptionAr: 'تمرين بسيط لكن فعال لتطوير السمانة.' },
  { id: 'seated-calf-raises', name: 'Seated Calf Raises', nameAr: 'رفع سمانة جالس', muscle: 'calves', goal: 'bulking', location: 'gym', gender: 'all', sets: 4, reps: '12-15', description: 'Machine exercise targeting soleus muscle.', descriptionAr: 'تمرين آلة يستهدف عضلة السمانة.' },
  { id: 'jump-rope', name: 'Jump Rope', nameAr: 'نط الحبل', muscle: 'calves', goal: 'cutting', location: 'home', gender: 'all', sets: 3, reps: '60 sec', description: 'Cardio exercise that builds calf endurance and burns fat.', descriptionAr: 'تمرين قلبي يبني تحمل السمانة ويحرق الدهون.' },
  { id: 'single-leg-calf-raise', name: 'Single Leg Calf Raise', nameAr: 'رفع سمانة ساق واحدة', muscle: 'calves', goal: 'fitness', location: 'home', gender: 'all', sets: 3, reps: '12 each', description: 'Unilateral calf exercise for balanced development.', descriptionAr: 'تمرين سمانة أحادي لتطوير متوازن.' },
];

export const exercises: Exercise[] = rawExercises.map((exercise) => ({
  ...exercise,
  name: repairMojibake(exercise.name),
  nameAr: repairMojibake(exercise.nameAr),
  description: repairMojibake(exercise.description),
  descriptionAr: repairMojibake(exercise.descriptionAr),
}));

export function getExercisesByFilters(
  selectedMuscles: string[],
  goal: string | null,
  location: string | null,
  gender: string | null = null
): Exercise[] {
  return exercises.filter((exercise) => {
    const muscleMatch = selectedMuscles.length === 0 || selectedMuscles.includes(exercise.muscle);
    const goalMatch = !goal || exercise.goal === 'all' || exercise.goal === goal;
    const locationMatch = !location || exercise.location === 'both' || exercise.location === location;
    const genderMatch = !gender || exercise.gender === 'all' || exercise.gender === gender;
    return muscleMatch && goalMatch && locationMatch && genderMatch;
  });
}


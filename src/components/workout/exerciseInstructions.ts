import { Exercise } from '@/data/exercises';
import { repairMojibake } from '@/lib/text';

export interface ExerciseInstructionPoint {
  en: string;
  ar: string;
}

function names(exercise: Exercise) {
  return {
    en: repairMojibake(exercise.name),
    ar: repairMojibake(exercise.nameAr || exercise.name),
  };
}

function closingPoint(exercise: Exercise): ExerciseInstructionPoint {
  return {
    en: `Complete ${exercise.sets} sets for ${exercise.reps} reps with smooth control and full range of motion.`,
    ar: `نفذ ${exercise.sets} مجموعات بعدد ${exercise.reps} تكرارات مع تحكم كامل ومدى حركة مناسب.`,
  };
}

function pressInstructions(exercise: Exercise): ExerciseInstructionPoint[] {
  const label = names(exercise);
  return [
    {
      en: `Set up for ${label.en} with your hands slightly wider than shoulder width and your chest lifted.`,
      ar: `استعد لتمرين ${label.ar} بوضع اليدين أوسع قليلًا من عرض الكتفين مع رفع الصدر.`,
    },
    {
      en: 'Brace your core, keep your shoulders packed, and lower the weight or your body in a controlled line.',
      ar: 'ثبت الجذع، واسحب الكتفين للخلف، ثم انزل بالوزن أو بالجسم بشكل متحكم فيه وفي مسار ثابت.',
    },
    {
      en: 'Drive back up by pressing through your palms while keeping your elbows aligned and your chest active.',
      ar: 'ادفع للأعلى من خلال الكفين مع الحفاظ على اتجاه المرفقين وتنشيط عضلات الصدر طوال الحركة.',
    },
    closingPoint(exercise),
  ];
}

function flyInstructions(exercise: Exercise): ExerciseInstructionPoint[] {
  const label = names(exercise);
  return [
    {
      en: `Start ${label.en} with a soft bend in the elbows and the chest open.`,
      ar: `ابدأ ${label.ar} بثني خفيف في المرفقين مع فتح الصدر.`,
    },
    {
      en: 'Open the arms out wide until you feel a stretch across the chest without dropping the shoulders.',
      ar: 'افتح الذراعين للخارج حتى تشعر بتمدد في الصدر من دون رفع الكتفين.',
    },
    {
      en: 'Bring the handles or dumbbells back together in an arc and squeeze the chest at the top.',
      ar: 'أعد المقابض أو الدمبل في مسار قوسي واضغط عضلات الصدر عند الوصول للأعلى.',
    },
    closingPoint(exercise),
  ];
}

function pullInstructions(exercise: Exercise): ExerciseInstructionPoint[] {
  const label = names(exercise);
  return [
    {
      en: `Begin ${label.en} with a long spine, shoulders down, and a secure grip on the bar or handle.`,
      ar: `ابدأ ${label.ar} بظهر مستقيم وكتفين منخفضين مع قبضة ثابتة على البار أو المقبض.`,
    },
    {
      en: 'Pull by driving the elbows down or back instead of yanking with the hands.',
      ar: 'اسحب عبر دفع المرفقين للأسفل أو للخلف بدلًا من شد اليدين فقط.',
    },
    {
      en: 'Pause when the bar or your body reaches the strongest position, then return slowly to the start.',
      ar: 'توقف لحظة عند أقوى نقطة في الحركة ثم ارجع ببطء إلى وضع البداية.',
    },
    closingPoint(exercise),
  ];
}

function rowInstructions(exercise: Exercise): ExerciseInstructionPoint[] {
  const label = names(exercise);
  return [
    {
      en: `Set up ${label.en} with a flat back, proud chest, and your core braced.`,
      ar: `جهز ${label.ar} مع ظهر مستقيم وصدر مرفوع وجذع مشدود.`,
    },
    {
      en: 'Pull the weight toward your lower ribs by leading with the elbow and squeezing the shoulder blade.',
      ar: 'اسحب الوزن نحو أسفل القفص الصدري مع قيادة الحركة بالمرفق وعصر لوح الكتف.',
    },
    {
      en: 'Lower the weight slowly until the arm extends again without rounding your back.',
      ar: 'أنزل الوزن ببطء حتى تعود الذراع للامتداد من دون تدوير الظهر.',
    },
    closingPoint(exercise),
  ];
}

function shoulderPressInstructions(exercise: Exercise): ExerciseInstructionPoint[] {
  const label = names(exercise);
  return [
    {
      en: `Start ${label.en} with the hands near shoulder level and the ribs stacked over the hips.`,
      ar: `ابدأ ${label.ar} واليدان عند مستوى الكتفين مع تثبيت القفص الصدري فوق الحوض.`,
    },
    {
      en: 'Press upward in a straight path while keeping the glutes and core tight.',
      ar: 'ادفع للأعلى في مسار مستقيم مع شد الجذع وعضلات المؤخرة.',
    },
    {
      en: 'Lower back to shoulder height with control and avoid arching your lower back.',
      ar: 'أنزل الوزن إلى مستوى الكتفين بتحكم وتجنب تقوس أسفل الظهر.',
    },
    closingPoint(exercise),
  ];
}

function raiseInstructions(exercise: Exercise): ExerciseInstructionPoint[] {
  const label = names(exercise);
  return [
    {
      en: `Hold the weight lightly for ${label.en} and stand tall with your arms starting close to the body.`,
      ar: `أمسك الوزن بخفة في ${label.ar} وقف باستقامة مع بدء الذراعين قريبًا من الجسم.`,
    },
    {
      en: 'Lift the arms until shoulder height with a slight bend in the elbows and no swinging.',
      ar: 'ارفع الذراعين حتى مستوى الكتف مع ثني بسيط في المرفقين ومن دون تأرجح.',
    },
    {
      en: 'Pause briefly at the top, then lower slowly to keep constant tension on the deltoids.',
      ar: 'توقف لحظة في الأعلى ثم انزل ببطء للحفاظ على الشد المستمر على عضلات الكتف.',
    },
    closingPoint(exercise),
  ];
}

function facePullInstructions(exercise: Exercise): ExerciseInstructionPoint[] {
  return [
    {
      en: 'Set the rope around face height and stand tall with your core engaged.',
      ar: 'اضبط الحبل عند مستوى الوجه وقف باستقامة مع شد الجذع.',
    },
    {
      en: 'Pull the rope toward your forehead while spreading the hands apart and lifting the elbows.',
      ar: 'اسحب الحبل نحو الجبهة مع فتح اليدين ورفع المرفقين للخارج.',
    },
    {
      en: 'Squeeze the rear shoulders at the end, then return slowly without letting the weight pull you forward.',
      ar: 'اعصر الكتف الخلفي في نهاية الحركة ثم ارجع ببطء من دون أن يسحبك الوزن للأمام.',
    },
    closingPoint(exercise),
  ];
}

function curlInstructions(exercise: Exercise): ExerciseInstructionPoint[] {
  const label = names(exercise);
  return [
    {
      en: `Begin ${label.en} with your elbows close to your sides and the chest up.`,
      ar: `ابدأ ${label.ar} مع إبقاء المرفقين قريبين من الجانبين والصدر مرفوعًا.`,
    },
    {
      en: 'Curl the weight by bending at the elbows only and avoid swinging your torso.',
      ar: 'ارفع الوزن عبر ثني المرفقين فقط وتجنب التأرجح بالجذع.',
    },
    {
      en: 'Squeeze the biceps at the top, then lower the weight slowly until the arms are nearly straight.',
      ar: 'اعصر عضلة البايسبس في الأعلى ثم أنزل الوزن ببطء حتى تقترب الذراع من الاستقامة.',
    },
    closingPoint(exercise),
  ];
}

function dipInstructions(exercise: Exercise): ExerciseInstructionPoint[] {
  return [
    {
      en: 'Place your hands on the bench or bars, lock the shoulders down, and keep the chest lifted.',
      ar: 'ضع اليدين على المقعد أو المتوازي مع تثبيت الكتفين للأسفل ورفع الصدر.',
    },
    {
      en: 'Lower by bending the elbows until the upper arms approach parallel to the floor.',
      ar: 'انزل بثني المرفقين حتى يقترب العضد من موازاة الأرض.',
    },
    {
      en: 'Press back up by straightening the elbows while keeping the body close to the bench.',
      ar: 'ادفع للأعلى عبر فرد المرفقين مع إبقاء الجسم قريبًا من المقعد.',
    },
    closingPoint(exercise),
  ];
}

function pushdownInstructions(exercise: Exercise): ExerciseInstructionPoint[] {
  return [
    {
      en: 'Stand tall at the cable with elbows pinned close to your ribs and wrists neutral.',
      ar: 'قف باستقامة أمام الكابل مع تثبيت المرفقين بجانب القفص الصدري والرسغين بشكل محايد.',
    },
    {
      en: 'Push the handle down until the arms are straight without letting the shoulders roll forward.',
      ar: 'ادفع المقبض للأسفل حتى تستقيم الذراعان من دون تدوير الكتفين للأمام.',
    },
    {
      en: 'Pause to squeeze the triceps, then return slowly until the forearms reach about ninety degrees.',
      ar: 'توقف لعصر عضلات الترايسبس ثم ارجع ببطء حتى تصل السواعد إلى زاوية تقارب تسعين درجة.',
    },
    closingPoint(exercise),
  ];
}

function overheadExtensionInstructions(exercise: Exercise): ExerciseInstructionPoint[] {
  return [
    {
      en: 'Hold the weight overhead with elbows pointing forward and the core braced.',
      ar: 'أمسك الوزن فوق الرأس مع توجيه المرفقين للأمام وشد الجذع.',
    },
    {
      en: 'Lower the weight behind your head by bending only at the elbows.',
      ar: 'أنزل الوزن خلف الرأس عبر ثني المرفقين فقط.',
    },
    {
      en: 'Extend the elbows to raise the weight back up and fully contract the triceps.',
      ar: 'افرد المرفقين لرفع الوزن للأعلى مجددًا مع عصر كامل لعضلات الترايسبس.',
    },
    closingPoint(exercise),
  ];
}

function kickbackInstructions(exercise: Exercise): ExerciseInstructionPoint[] {
  return [
    {
      en: 'Hinge forward with a flat back and bring the upper arm slightly above the torso.',
      ar: 'انحن للأمام مع ظهر مستقيم وارفع العضد قليلًا فوق مستوى الجذع.',
    },
    {
      en: 'Extend the elbow backward until the arm is straight without moving the shoulder.',
      ar: 'افرد المرفق للخلف حتى تستقيم الذراع من دون تحريك الكتف.',
    },
    {
      en: 'Hold the squeeze briefly, then bend the elbow slowly back to the start.',
      ar: 'احتفظ بالعصر لحظة ثم اثنِ المرفق ببطء للعودة إلى البداية.',
    },
    closingPoint(exercise),
  ];
}

function plankInstructions(exercise: Exercise): ExerciseInstructionPoint[] {
  return [
    {
      en: 'Place your forearms under the shoulders and extend the legs behind you in one straight line.',
      ar: 'ضع الساعدين تحت الكتفين ومد الساقين للخلف ليكون الجسم في خط مستقيم.',
    },
    {
      en: 'Brace the abs, squeeze the glutes, and keep the hips level with the shoulders.',
      ar: 'اشد عضلات البطن واعصر المؤخرة وحافظ على مستوى الحوض مع الكتفين.',
    },
    {
      en: 'Breathe steadily while holding still and avoid dropping or piking the hips.',
      ar: 'تنفس بهدوء أثناء الثبات وتجنب هبوط الحوض أو رفعه أكثر من اللازم.',
    },
    closingPoint(exercise),
  ];
}

function crunchInstructions(exercise: Exercise): ExerciseInstructionPoint[] {
  const label = names(exercise);
  return [
    {
      en: `Lie down for ${label.en} with the lower back supported and the chin relaxed.`,
      ar: `استلقِ لتمرين ${label.ar} مع تثبيت أسفل الظهر وإرخاء الذقن.`,
    },
    {
      en: 'Lift the shoulders by curling the rib cage toward the pelvis rather than pulling on the neck.',
      ar: 'ارفع الكتفين عبر تقريب القفص الصدري من الحوض بدلًا من شد الرقبة.',
    },
    {
      en: 'Pause at the top for abdominal tension, then lower slowly with control.',
      ar: 'توقف في الأعلى لتشعر بشد عضلات البطن ثم انزل ببطء وتحكم.',
    },
    closingPoint(exercise),
  ];
}

function legRaiseInstructions(exercise: Exercise): ExerciseInstructionPoint[] {
  return [
    {
      en: 'Lie flat or hang with the core braced and the legs together.',
      ar: 'استلقِ أو تعلق مع شد الجذع وإبقاء الساقين معًا.',
    },
    {
      en: 'Raise the legs by curling the pelvis upward rather than swinging the hips.',
      ar: 'ارفع الساقين عبر لف الحوض للأعلى بدلًا من التأرجح بالحوض.',
    },
    {
      en: 'Lower the legs slowly until just before the lower back loses contact or control.',
      ar: 'أنزل الساقين ببطء حتى قبل أن يفقد أسفل الظهر التلامس أو التحكم.',
    },
    closingPoint(exercise),
  ];
}

function mountainClimberInstructions(exercise: Exercise): ExerciseInstructionPoint[] {
  return [
    {
      en: 'Start in a strong plank with the shoulders over the hands and the hips level.',
      ar: 'ابدأ بوضع بلانك قوي مع الكتفين فوق اليدين والحوض ثابتًا.',
    },
    {
      en: 'Drive one knee toward the chest while the other leg stays extended and active.',
      ar: 'اسحب ركبة واحدة نحو الصدر مع إبقاء الساق الأخرى ممتدة ونشطة.',
    },
    {
      en: 'Switch legs rhythmically without bouncing the hips or collapsing the shoulders.',
      ar: 'بدل بين الساقين بإيقاع ثابت من دون ارتداد الحوض أو هبوط الكتفين.',
    },
    closingPoint(exercise),
  ];
}

function russianTwistInstructions(exercise: Exercise): ExerciseInstructionPoint[] {
  return [
    {
      en: 'Sit tall with the chest up, lean back slightly, and lift the feet if you can control the position.',
      ar: 'اجلس مع رفع الصدر ومل للخلف قليلًا وارفع القدمين إذا استطعت الحفاظ على الثبات.',
    },
    {
      en: 'Rotate the torso from side to side by moving the ribs, not just the arms.',
      ar: 'لف الجذع من جانب إلى جانب عبر تحريك القفص الصدري وليس الذراعين فقط.',
    },
    {
      en: 'Keep the abs tight and the spine long while tapping each side with control.',
      ar: 'حافظ على شد البطن وطول العمود الفقري أثناء لمس كل جانب بتحكم.',
    },
    closingPoint(exercise),
  ];
}

function deadBugInstructions(exercise: Exercise): ExerciseInstructionPoint[] {
  return [
    {
      en: 'Lie on your back with arms up, knees bent over the hips, and the lower back gently pressed down.',
      ar: 'استلقِ على ظهرك مع رفع الذراعين وثني الركبتين فوق الحوض والضغط الخفيف بأسفل الظهر نحو الأرض.',
    },
    {
      en: 'Extend one arm and the opposite leg slowly while keeping the trunk perfectly still.',
      ar: 'مد ذراعًا واحدة مع الساق المعاكسة ببطء مع إبقاء الجذع ثابتًا تمامًا.',
    },
    {
      en: 'Return to the center and alternate sides without letting the ribs flare.',
      ar: 'ارجع إلى المنتصف وبدل الجانبين من دون فتح القفص الصدري للأعلى.',
    },
    closingPoint(exercise),
  ];
}

function squatInstructions(exercise: Exercise): ExerciseInstructionPoint[] {
  const label = names(exercise);
  return [
    {
      en: `Stand for ${label.en} with feet planted firmly and the chest tall.`,
      ar: `قف لتمرين ${label.ar} مع تثبيت القدمين جيدًا ورفع الصدر.`,
    },
    {
      en: 'Push the hips back and bend the knees while tracking them over the toes.',
      ar: 'ادفع الحوض للخلف واثنِ الركبتين مع توجيههما فوق اتجاه أصابع القدم.',
    },
    {
      en: 'Drive through the mid-foot to stand back up while squeezing the glutes at the top.',
      ar: 'ادفع من منتصف القدم للوقوف مجددًا مع عصر المؤخرة في أعلى الحركة.',
    },
    closingPoint(exercise),
  ];
}

function legPressInstructions(exercise: Exercise): ExerciseInstructionPoint[] {
  return [
    {
      en: 'Place your feet on the platform about shoulder width apart and keep the lower back supported.',
      ar: 'ضع القدمين على المنصة بعرض الكتفين تقريبًا مع إبقاء أسفل الظهر مدعومًا.',
    },
    {
      en: 'Lower the platform by bending the knees until you reach a comfortable deep range.',
      ar: 'أنزل المنصة عبر ثني الركبتين حتى تصل إلى مدى عميق ومريح.',
    },
    {
      en: 'Press the platform away without locking the knees aggressively at the top.',
      ar: 'ادفع المنصة بعيدًا من دون قفل الركبتين بعنف في أعلى الحركة.',
    },
    closingPoint(exercise),
  ];
}

function lungeInstructions(exercise: Exercise): ExerciseInstructionPoint[] {
  return [
    {
      en: 'Step into position with the torso upright and the front foot planted firmly.',
      ar: 'اتخذ وضع البداية مع إبقاء الجذع مستقيمًا والقدم الأمامية ثابتة بقوة.',
    },
    {
      en: 'Lower under control until both knees bend deeply while keeping balance through the front heel.',
      ar: 'انزل بتحكم حتى تنثني الركبتان بعمق مع الحفاظ على التوازن عبر كعب القدم الأمامية.',
    },
    {
      en: 'Push through the front leg to return, then repeat evenly on both sides when needed.',
      ar: 'ادفع من الساق الأمامية للعودة ثم كرر بالتساوي على الجانبين عند الحاجة.',
    },
    closingPoint(exercise),
  ];
}

function legExtensionInstructions(exercise: Exercise): ExerciseInstructionPoint[] {
  return [
    {
      en: 'Sit tall in the machine with the pad resting comfortably over the front of the ankles.',
      ar: 'اجلس باستقامة على الجهاز مع ارتكاز الوسادة بشكل مريح على مقدمة الكاحلين.',
    },
    {
      en: 'Extend the knees until the legs are nearly straight while keeping the hips down.',
      ar: 'افرد الركبتين حتى تقترب الساقان من الاستقامة مع إبقاء الحوض ثابتًا.',
    },
    {
      en: 'Pause to squeeze the quads, then lower slowly back to the starting angle.',
      ar: 'توقف لعصر عضلات الفخذ الأمامي ثم انزل ببطء إلى زاوية البداية.',
    },
    closingPoint(exercise),
  ];
}

function wallSitInstructions(exercise: Exercise): ExerciseInstructionPoint[] {
  return [
    {
      en: 'Lean your back flat against the wall and walk the feet forward until the knees bend deeply.',
      ar: 'أسند ظهرك بالكامل على الحائط وقدم القدمين للأمام حتى تنثني الركبتان بعمق.',
    },
    {
      en: 'Keep the thighs as close to parallel to the floor as your mobility allows.',
      ar: 'حافظ على الفخذين قريبين من موازاة الأرض حسب مرونتك وقدرتك.',
    },
    {
      en: 'Hold the position while breathing steadily and keeping pressure through the whole foot.',
      ar: 'اثبت في الوضعية مع تنفس منتظم والحفاظ على الضغط عبر كامل القدم.',
    },
    closingPoint(exercise),
  ];
}

function hingeInstructions(exercise: Exercise): ExerciseInstructionPoint[] {
  return [
    {
      en: 'Stand tall with the weight close to the body and the knees softly bent.',
      ar: 'قف باستقامة مع إبقاء الوزن قريبًا من الجسم وثني بسيط في الركبتين.',
    },
    {
      en: 'Push the hips back while keeping the spine long and the weight close to the legs.',
      ar: 'ادفع الحوض للخلف مع الحفاظ على طول العمود الفقري وقرب الوزن من الساقين.',
    },
    {
      en: 'Drive the hips forward to stand tall again and squeeze the glutes at the finish.',
      ar: 'ادفع الحوض للأمام للوقوف مجددًا واعصر المؤخرة عند نهاية الحركة.',
    },
    closingPoint(exercise),
  ];
}

function bridgeInstructions(exercise: Exercise): ExerciseInstructionPoint[] {
  return [
    {
      en: 'Set the upper back or shoulders in place and plant the feet firmly under the knees.',
      ar: 'ثبت أعلى الظهر أو الكتفين في مكانهما واغرس القدمين جيدًا تحت الركبتين.',
    },
    {
      en: 'Lift the hips by driving through the heels until the hips fully extend.',
      ar: 'ارفع الحوض عبر الضغط بالكعبين حتى يصل الحوض إلى التمدد الكامل.',
    },
    {
      en: 'Pause to squeeze the glutes, then lower with control without losing tension.',
      ar: 'توقف لعصر المؤخرة ثم انزل بتحكم من دون فقدان الشد العضلي.',
    },
    closingPoint(exercise),
  ];
}

function legCurlInstructions(exercise: Exercise): ExerciseInstructionPoint[] {
  return [
    {
      en: 'Set the machine or body position so the knees align with the pivot point and the hips stay still.',
      ar: 'اضبط الجهاز أو وضعية الجسم بحيث تتماشى الركبتان مع محور الحركة ويبقى الحوض ثابتًا.',
    },
    {
      en: 'Curl the heels toward the glutes by bending at the knees only.',
      ar: 'اسحب الكعبين نحو المؤخرة عبر ثني الركبتين فقط.',
    },
    {
      en: 'Squeeze the hamstrings at the top and lower slowly to the start.',
      ar: 'اعصر عضلات الفخذ الخلفي في الأعلى ثم ارجع ببطء إلى البداية.',
    },
    closingPoint(exercise),
  ];
}

function gluteIsolationInstructions(exercise: Exercise): ExerciseInstructionPoint[] {
  return [
    {
      en: 'Set your body or machine position so the hips stay square and the core stays tight.',
      ar: 'اضبط وضع الجسم أو الجهاز بحيث يبقى الحوض متساويًا ويظل الجذع مشدودًا.',
    },
    {
      en: 'Move the working leg or hip through the target path without swinging the torso.',
      ar: 'حرك الساق أو الورك العامل في المسار المطلوب من دون تأرجح الجذع.',
    },
    {
      en: 'Pause at the point of maximum glute tension, then return slowly with control.',
      ar: 'توقف عند أعلى نقطة شد في المؤخرة ثم ارجع ببطء وتحكم.',
    },
    closingPoint(exercise),
  ];
}

function calfRaiseInstructions(exercise: Exercise): ExerciseInstructionPoint[] {
  return [
    {
      en: 'Stand or sit with the balls of the feet supported and your posture stable.',
      ar: 'قف أو اجلس مع ارتكاز مقدمة القدمين وثبات وضعية الجسم.',
    },
    {
      en: 'Press through the toes to raise the heels as high as possible.',
      ar: 'ادفع عبر أصابع القدم لرفع الكعبين إلى أعلى نقطة ممكنة.',
    },
    {
      en: 'Lower the heels slowly to feel a stretch in the calves before the next rep.',
      ar: 'أنزل الكعبين ببطء لتشعر بتمدد في السمانة قبل التكرار التالي.',
    },
    closingPoint(exercise),
  ];
}

function jumpRopeInstructions(exercise: Exercise): ExerciseInstructionPoint[] {
  return [
    {
      en: 'Hold the handles lightly, keep the elbows close, and stay tall through the torso.',
      ar: 'أمسك المقابض بخفة، وأبقِ المرفقين قريبين، وحافظ على استقامة الجذع.',
    },
    {
      en: 'Turn the rope mainly with the wrists and jump just high enough for the rope to pass.',
      ar: 'لف الحبل أساسًا عبر الرسغين واقفز بارتفاع بسيط يسمح بمرور الحبل فقط.',
    },
    {
      en: 'Land softly on the balls of the feet and keep a smooth rhythm throughout the set.',
      ar: 'اهبط بخفة على مقدمة القدمين وحافظ على إيقاع سلس طوال المجموعة.',
    },
    closingPoint(exercise),
  ];
}

function supermanInstructions(exercise: Exercise): ExerciseInstructionPoint[] {
  return [
    {
      en: 'Lie face down with the arms extended and the neck in a neutral position.',
      ar: 'استلقِ على البطن مع مد الذراعين والحفاظ على الرقبة في وضع محايد.',
    },
    {
      en: 'Lift the chest, arms, and legs slightly off the floor by contracting the back and glutes.',
      ar: 'ارفع الصدر والذراعين والساقين قليلًا عن الأرض عبر شد الظهر والمؤخرة.',
    },
    {
      en: 'Hold briefly without compressing the neck, then lower back down with control.',
      ar: 'اثبت لحظة من دون ضغط على الرقبة ثم انزل ببطء وتحكم.',
    },
    closingPoint(exercise),
  ];
}

function fallbackInstructions(exercise: Exercise): ExerciseInstructionPoint[] {
  const label = names(exercise);
  return [
    {
      en: `Set up for ${label.en} in a strong, balanced position before starting the first rep.`,
      ar: `اتخذ وضعية قوية ومتوازنة لتمرين ${label.ar} قبل بدء أول تكرار.`,
    },
    {
      en: 'Move through the working range with controlled tempo and stable posture.',
      ar: 'تحرك خلال مدى الحركة المطلوب بإيقاع متحكم ووضعية ثابتة.',
    },
    {
      en: 'Return to the starting position slowly while keeping tension on the target muscle.',
      ar: 'ارجع إلى وضع البداية ببطء مع الحفاظ على الشد على العضلة المستهدفة.',
    },
    closingPoint(exercise),
  ];
}

export function buildExerciseInstructions(exercise: Exercise): ExerciseInstructionPoint[] {
  const id = exercise.id;

  if (/(push-ups|bench-press|chest-press-machine)/.test(id)) return pressInstructions(exercise);
  if (/(chest-fly)/.test(id)) return flyInstructions(exercise);
  if (/(pull-ups|chin-ups|lat-pulldown)/.test(id)) return pullInstructions(exercise);
  if (/(rows|single-arm-row|seated-cable-row)/.test(id)) return rowInstructions(exercise);
  if (/(shoulder-press|pike-push-ups)/.test(id)) return shoulderPressInstructions(exercise);
  if (/(lateral-raises|front-raises)/.test(id)) return raiseInstructions(exercise);
  if (/(face-pulls)/.test(id)) return facePullInstructions(exercise);
  if (/(bicep-curls|hammer-curls|concentration-curls|light-bicep-curls)/.test(id)) return curlInstructions(exercise);
  if (/(tricep-dips)/.test(id)) return dipInstructions(exercise);
  if (/(tricep-pushdown)/.test(id)) return pushdownInstructions(exercise);
  if (/(overhead-tricep-extension)/.test(id)) return overheadExtensionInstructions(exercise);
  if (/(tricep-kickback)/.test(id)) return kickbackInstructions(exercise);
  if (/(plank)/.test(id)) return plankInstructions(exercise);
  if (/(crunches)/.test(id)) return crunchInstructions(exercise);
  if (/(leg-raises)/.test(id)) return legRaiseInstructions(exercise);
  if (/(mountain-climbers)/.test(id)) return mountainClimberInstructions(exercise);
  if (/(russian-twists)/.test(id)) return russianTwistInstructions(exercise);
  if (/(dead-bug)/.test(id)) return deadBugInstructions(exercise);
  if (/^(squats|goblet-squats|sumo-squats)$/.test(id)) return squatInstructions(exercise);
  if (/(leg-press)/.test(id)) return legPressInstructions(exercise);
  if (/(lunges|bulgarian-split-squats)/.test(id)) return lungeInstructions(exercise);
  if (/(leg-extensions)/.test(id)) return legExtensionInstructions(exercise);
  if (/(wall-sit)/.test(id)) return wallSitInstructions(exercise);
  if (/(romanian-deadlift|cable-pull-through)/.test(id)) return hingeInstructions(exercise);
  if (/(glute-bridge|single-leg-bridge|hip-thrust)/.test(id)) return bridgeInstructions(exercise);
  if (/(leg-curls|nordic-curls)/.test(id)) return legCurlInstructions(exercise);
  if (/(donkey-kicks|fire-hydrants|glute-kickback-machine|banded-walks)/.test(id)) return gluteIsolationInstructions(exercise);
  if (/(calf-raises|single-leg-calf-raise)/.test(id)) return calfRaiseInstructions(exercise);
  if (/(jump-rope)/.test(id)) return jumpRopeInstructions(exercise);
  if (/(superman)/.test(id)) return supermanInstructions(exercise);

  return fallbackInstructions(exercise);
}
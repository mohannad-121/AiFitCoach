import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { repairMojibake } from '@/lib/text';

type Language = 'en' | 'ar';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
  dir: 'ltr' | 'rtl';
}

const translations: Record<Language, Record<string, string>> = {
  en: {
    // Navigation
    'nav.home': 'Home',
    'nav.workouts': 'Workouts',
    'nav.coach': 'AI Coach',
    'nav.profile': 'Profile',
    'nav.schedule': 'Schedule',
    'nav.liveCoach': 'Live Coach',
    'nav.coachNotes': 'Coach Notes',
    'nav.subscription': 'Subscription',
    'nav.admin': 'Admin',
    'nav.menu': 'More',
    'nav.login': 'Login',
    'nav.logout': 'Logout',

    // Hero
    'hero.eyebrow': 'AI TRAINING, BUILT AROUND YOU',
    'hero.title': 'YOUR AI FITNESS COACH, REIMAGINED.',
    'hero.subtitle': 'Personalized training, nutrition intelligence, live progress, and AI coaching — built around your body, goals, and lifestyle.',
    'hero.cta': 'Start Coaching',
    'hero.secondary': 'Explore Features',

    // Onboarding
    'onboarding.welcome': "Let's Get Started",
    'onboarding.step1': 'Basic Info',
    'onboarding.step2': 'Body Stats',
    'onboarding.step3': 'Your Goals',
    'onboarding.step4': 'Training Details',
    'onboarding.step5': 'Workout Preference',
    'onboarding.name': "What's your name?",
    'onboarding.age': 'How old are you?',
    'onboarding.gender': 'Gender',
    'onboarding.male': 'Male',
    'onboarding.female': 'Female',
    'onboarding.weight': 'Weight (kg)',
    'onboarding.height': 'Height (cm)',
    'onboarding.goal': "What's your goal?",
    'onboarding.bulking': 'Build Muscle',
    'onboarding.cutting': 'Lose Weight',
    'onboarding.fitness': 'General Fitness',
    'onboarding.beginner': 'Beginner',
    'onboarding.intermediate': 'Intermediate',
    'onboarding.advanced': 'Advanced',
    'onboarding.activity.low': 'Low',
    'onboarding.activity.moderate': 'Moderate',
    'onboarding.activity.high': 'High',
    'onboarding.location': 'Where do you workout?',
    'onboarding.home': 'Home',
    'onboarding.gym': 'Gym',
    'onboarding.next': 'Continue',
    'onboarding.back': 'Back',
    'onboarding.finish': 'Start Training',

    // Workouts
    'workouts.title': 'MUSCLE MAP',
    'workouts.subtitle': 'Select target muscles to find exercises',
    'workouts.filter.all': 'All',
    'workouts.filter.goal': 'By Goal',
    'workouts.filter.muscle': 'By Muscle',
    'workouts.exercises': 'exercises found',
    'workouts.sets': 'Sets',
    'workouts.reps': 'Reps',
    'workouts.watch': 'Watch Video',
    'workouts.noResults': 'No exercises found. Try adjusting your filters.',

    // Muscles
    'muscle.chest': 'Chest',
    'muscle.back': 'Back',
    'muscle.shoulders': 'Shoulders',
    'muscle.biceps': 'Biceps',
    'muscle.triceps': 'Triceps',
    'muscle.abs': 'Abs',
    'muscle.quads': 'Quads',
    'muscle.hamstrings': 'Hamstrings',
    'muscle.glutes': 'Glutes',
    'muscle.calves': 'Calves',

    // AI Coach
    'coach.title': 'AI Fitness Coach',
    'coach.subtitle': 'Your personal fitness & nutrition advisor',
    'coach.placeholder': 'Ask me anything about fitness...',
    'coach.send': 'Send',
    'coach.greeting': "Hey! 👋 I'm your personal AI fitness coach. Ask me about workouts, nutrition, or anything fitness-related! You can also use voice to chat. What can I help you with today?",
    'coach.newChat': 'New Chat',
    'coach.history': 'Chat History',
    'coach.autoSpeakOn': 'Auto-speak is on',
    'coach.autoSpeakOff': 'Auto-speak is off',

    // Common
    'common.loading': 'Loading...',
    'common.error': 'Something went wrong',
    'common.save': 'Save',
    'common.cancel': 'Cancel',

    // Subscription
    'subscription.membership': 'FitCoach membership',
    'subscription.title': 'Train without limits.',
    'subscription.subtitle': 'Choose the intelligence, uploads, and plan capacity that fit your goals.',
    'subscription.currentPlan': 'Current Plan',
    'subscription.billingPeriod': 'Billing period',
    'subscription.manageBilling': 'Manage Billing',
    'subscription.billingUnavailable': 'Billing is temporarily unavailable. Showing plans while the backend reconnects.',
    'subscription.uploads': 'Uploads',
    'subscription.messages': 'Chat Messages',
    'subscription.generatedPlans': 'Generated Plans',
    'subscription.unlimited': 'unlimited',
    'subscription.limitReached': 'Limit reached. Upgrade to continue.',
    'subscription.bestValue': 'Best Value',
    'subscription.current': 'Current Plan',
    'subscription.manageDowngrade': 'Manage downgrade',
    'subscription.upgradeTo': 'Upgrade to',
    'subscription.plan.free.name': 'Free',
    'subscription.plan.plus.name': 'Plus',
    'subscription.plan.pro.name': 'Pro',
    'subscription.plan.free.uploads': '2 uploads',
    'subscription.plan.free.messages': '30 chat messages',
    'subscription.plan.free.plans': '1 generated plan',
    'subscription.plan.plus.uploads': '15 uploads',
    'subscription.plan.plus.messages': '60 chat messages',
    'subscription.plan.plus.plans': '3 generated plans',
    'subscription.plan.pro.uploads': '30 uploads',
    'subscription.plan.pro.messages': '100 chat messages',
    'subscription.plan.pro.plans': '10 generated plans',
    'subscription.viewPlan': 'View plan',
    'subscription.planCreditsUsed': 'Plan credits used',
    'subscription.upgrade': 'Upgrade',
    'subscription.generatedLimitTitle': 'You reached your generated plan limit',
    'subscription.planLimitTitle': 'You reached your plan limit',
    'subscription.generatedLimitDescription': 'Upgrade to create more personalized plans.',
    'subscription.planLimitDescription': 'Upgrade to continue using your coach features.',
    'subscription.maybeLater': 'Maybe later',

    // Not found
    'notFound.eyebrow': 'LOST REP',
    'notFound.title': 'This route is off the training plan.',
    'notFound.description': 'Return to your dashboard or explore workouts to get back on track.',
    'notFound.home': 'Home',
    'notFound.workouts': 'Workouts',
  },
  ar: {
    // Navigation
    'nav.home': 'الرئيسية',
    'nav.workouts': 'التمارين',
    'nav.coach': 'المدرب الذكي',
    'nav.profile': 'الملف',
    'nav.schedule': 'الجدول',
    'nav.liveCoach': 'المدرب المباشر',
    'nav.coachNotes': 'ملاحظات المدرب',
    'nav.subscription': 'الاشتراك',
    'nav.admin': 'الإدارة',
    'nav.menu': 'القائمة',
    'nav.login': 'دخول',
    'nav.logout': 'خروج',

    // Hero
    'hero.eyebrow': 'تدريب ذكي مصمم لك',
    'hero.title': 'مدرب لياقتك بالذكاء الاصطناعي، بتجربة جديدة.',
    'hero.subtitle': 'تدريب شخصي، وذكاء غذائي، وتقدم مباشر، وتوجيه بالذكاء الاصطناعي — مصمم لجسمك وأهدافك وأسلوب حياتك.',
    'hero.cta': 'ابدأ التدريب',
    'hero.secondary': 'استكشف المزايا',

    // Onboarding
    'onboarding.welcome': 'هيا نبدأ',
    'onboarding.step1': 'معلومات أساسية',
    'onboarding.step2': 'قياسات الجسم',
    'onboarding.step3': 'أهدافك',
    'onboarding.step4': 'تفاصيل التدريب',
    'onboarding.step5': 'مكان التمرين',
    'onboarding.name': 'شو اسمك؟',
    'onboarding.age': 'كم عمرك؟',
    'onboarding.gender': 'الجنس',
    'onboarding.male': 'ذكر',
    'onboarding.female': 'أنثى',
    'onboarding.weight': 'الوزن (كغ)',
    'onboarding.height': 'الطول (سم)',
    'onboarding.goal': 'شو هدفك؟',
    'onboarding.bulking': 'بناء عضلات',
    'onboarding.cutting': 'إنقاص الوزن',
    'onboarding.fitness': 'لياقة عامة',
    'onboarding.beginner': 'مبتدئ',
    'onboarding.intermediate': 'متوسط',
    'onboarding.advanced': 'متقدم',
    'onboarding.activity.low': 'منخفض',
    'onboarding.activity.moderate': 'متوسط',
    'onboarding.activity.high': 'مرتفع',
    'onboarding.location': 'وين بتتمرن؟',
    'onboarding.home': 'البيت',
    'onboarding.gym': 'الجيم',
    'onboarding.next': 'التالي',
    'onboarding.back': 'رجوع',
    'onboarding.finish': 'ابدأ التمرين',

    // Workouts
    'workouts.title': 'خريطة العضلات',
    'workouts.subtitle': 'اختر العضلات المستهدفة لعرض التمارين',
    'workouts.filter.all': 'الكل',
    'workouts.filter.goal': 'حسب الهدف',
    'workouts.filter.muscle': 'حسب العضلة',
    'workouts.exercises': 'تمرين',
    'workouts.sets': 'مجموعات',
    'workouts.reps': 'تكرارات',
    'workouts.watch': 'شاهد الفيديو',
    'workouts.noResults': 'ما لقيت تمارين. جرب تغير الفلاتر.',

    // Muscles
    'muscle.chest': 'الصدر',
    'muscle.back': 'الظهر',
    'muscle.shoulders': 'الأكتاف',
    'muscle.biceps': 'الباي',
    'muscle.triceps': 'التراي',
    'muscle.abs': 'البطن',
    'muscle.quads': 'الفخذ الأمامي',
    'muscle.hamstrings': 'الفخذ الخلفي',
    'muscle.glutes': 'المؤخرة',
    'muscle.calves': 'السمانة',

    // AI Coach
    'coach.title': 'المدرب الذكي',
    'coach.subtitle': 'مستشارك الشخصي للتمارين والتغذية',
    'coach.placeholder': 'اسألني أي شي عن اللياقة...',
    'coach.send': 'إرسال',
    'coach.greeting': 'مرحبا! 👋 أنا مدربك الشخصي بالذكاء الاصطناعي. اسألني عن التمارين أو التغذية أو أي شي يخص اللياقة! بتقدر كمان تحكيلي صوت. كيف بقدر أساعدك اليوم؟',
    'coach.newChat': 'محادثة جديدة',
    'coach.history': 'سجل المحادثات',
    'coach.autoSpeakOn': 'القراءة التلقائية مفعلة',
    'coach.autoSpeakOff': 'القراءة التلقائية متوقفة',

    // Common
    'common.loading': 'جاري التحميل...',
    'common.error': 'صار خطأ',
    'common.save': 'حفظ',
    'common.cancel': 'إلغاء',

    // Subscription
    'subscription.membership': 'عضوية فت كوتش',
    'subscription.title': 'تدرّب بلا حدود.',
    'subscription.subtitle': 'اختر مستوى الذكاء وسعة الرفع والخطط التي تناسب أهدافك.',
    'subscription.currentPlan': 'الخطة الحالية',
    'subscription.billingPeriod': 'فترة الفوترة',
    'subscription.manageBilling': 'إدارة الفوترة',
    'subscription.billingUnavailable': 'الفوترة غير متاحة مؤقتًا. نعرض الخطط إلى أن يعاود الخادم الاتصال.',
    'subscription.uploads': 'الملفات المرفوعة',
    'subscription.messages': 'رسائل المحادثة',
    'subscription.generatedPlans': 'الخطط المُنشأة',
    'subscription.unlimited': 'غير محدود',
    'subscription.limitReached': 'تم الوصول إلى الحد. قم بالترقية للمتابعة.',
    'subscription.bestValue': 'أفضل قيمة',
    'subscription.current': 'الخطة الحالية',
    'subscription.manageDowngrade': 'إدارة التخفيض',
    'subscription.upgradeTo': 'الترقية إلى',
    'subscription.plan.free.name': 'مجاني',
    'subscription.plan.plus.name': 'بلس',
    'subscription.plan.pro.name': 'برو',
    'subscription.plan.free.uploads': 'رفع ملفين',
    'subscription.plan.free.messages': '30 رسالة محادثة',
    'subscription.plan.free.plans': 'خطة واحدة مُنشأة',
    'subscription.plan.plus.uploads': 'رفع 15 ملفًا',
    'subscription.plan.plus.messages': '60 رسالة محادثة',
    'subscription.plan.plus.plans': '3 خطط مُنشأة',
    'subscription.plan.pro.uploads': 'رفع 30 ملفًا',
    'subscription.plan.pro.messages': '100 رسالة محادثة',
    'subscription.plan.pro.plans': '10 خطط مُنشأة',
    'subscription.viewPlan': 'عرض الخطة',
    'subscription.planCreditsUsed': 'تم استخدام رصيد الخطط',
    'subscription.upgrade': 'ترقية',
    'subscription.generatedLimitTitle': 'وصلت إلى حد الخطط المُنشأة',
    'subscription.planLimitTitle': 'وصلت إلى حد خطتك',
    'subscription.generatedLimitDescription': 'قم بالترقية لإنشاء المزيد من الخطط المخصصة.',
    'subscription.planLimitDescription': 'قم بالترقية لمتابعة استخدام ميزات المدرب.',
    'subscription.maybeLater': 'لاحقًا',

    // Not found
    'notFound.eyebrow': 'طريق مفقود',
    'notFound.title': 'هذه الصفحة خارج خطتك التدريبية.',
    'notFound.description': 'ارجع إلى لوحة التحكم أو استكشف التمارين للعودة إلى المسار.',
    'notFound.home': 'الرئيسية',
    'notFound.workouts': 'التمارين',
  },
};

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

function getInitialLanguage(): Language {
  try {
    return localStorage.getItem('fitcoach_language') === 'ar' ? 'ar' : 'en';
  } catch {
    return 'en';
  }
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(getInitialLanguage);
  const dir = language === 'ar' ? 'rtl' : 'ltr';

  const setLanguage = useCallback((nextLanguage: Language) => {
    setLanguageState(nextLanguage === 'ar' ? 'ar' : 'en');
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = dir;
    try {
      localStorage.setItem('fitcoach_language', language);
    } catch {
      // Keep the selected language for the current visit when storage is unavailable.
    }
  }, [dir, language]);

  const t = useCallback((key: string): string => {
    const value = translations[language][key] || key;
    return repairMojibake(value);
  }, [language]);

  const value = useMemo(() => ({ language, setLanguage, t, dir }), [dir, language, setLanguage, t]);

  return (
    <LanguageContext.Provider value={value}>
      <div dir={dir} data-language={language}>{children}</div>
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}

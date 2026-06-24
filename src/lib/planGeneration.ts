const normalize = (value: string) => value
  .toLocaleLowerCase()
  .normalize('NFKD')
  .replace(/[\u0300-\u036f\u064B-\u065F\u0670]/g, '')
  .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const explanationTerms = [
  'translate', 'translation', 'explain', 'summarize', 'clarify',
  'ترجم', 'ترجمة', 'اشرح', 'فسر', 'لخص',
  'переведи', 'перевести', 'объясни',
  'traduce', 'traducir', 'explica',
  'traduis', 'traduire', 'explique',
  'çevir', 'tercüme', 'açıkla', 'acikla',
  'übersetze', 'ubersetze', 'erkläre', 'erklare',
  'traduci', 'spiega', 'traduz', 'traduza', 'explique',
];

const planNouns = [
  'plan', 'program', 'programme', 'schedule', 'routine',
  'خطة', 'خطه', 'برنامج', 'جدول', 'نظام غذائي',
  'план', 'программ', 'расписание', 'рацион',
  'programa', 'rutina', 'horario', 'planning', 'regime',
  'planı', 'plani', 'programı', 'programi',
  'trainingsplan', 'ernahrungsplan', 'piano', 'programma', 'scheda',
  'plano', 'rotina',
];

const fitnessDomains = [
  'workout', 'training', 'exercise', 'fitness', 'nutrition', 'diet', 'meal', 'weekly',
  'تمرين', 'تمارين', 'تدريب', 'غذاء', 'غذائي', 'تغذية', 'وجبات', 'اسبوعي',
  'трениров', 'упражнен', 'питани', 'диет', 'недел',
  'entrenamiento', 'ejercicio', 'nutric', 'dieta', 'semanal',
  'entrainement', 'musculation', 'hebdomadaire',
  'antrenman', 'egzersiz', 'diyet', 'haftalık', 'haftalik',
  'ernahrung', 'wochentlich', 'allenamento', 'esercizi', 'alimentazione', 'settimanale',
  'treino', 'exercicio', 'alimentacao',
];

const createTerms = [
  'give me', 'create', 'generate', 'make me', 'build', 'design', 'prepare', 'write me', 'i want', 'i need',
  'اعطيني', 'أعطيني', 'بدي', 'اريد', 'أريد', 'اعمللي', 'اعملي', 'انشئ', 'أنشئ', 'جهز',
  'хочу', 'составь', 'составить', 'дай мне', 'сделай', 'создай', 'нужна', 'нужен',
  'dame', 'crea', 'hazme', 'quiero', 'necesito',
  'donne-moi', 'donne moi', 'cree', 'fais-moi', 'fais moi', 'je veux',
  'bana', 'hazırla', 'hazirla', 'oluştur', 'olustur', 'yap',
  'erstelle', 'mach mir', 'gib mir', 'ich mochte',
  'fammi', 'prepara', 'voglio', 'crie', 'faca', 'monte', 'quero',
];

const durationTerms = [
  'week', 'weekly', '7 day', 'month', 'daily', 'for the week',
  'اسبوع', 'أسبوع', 'شهري', 'يومي', 'недел', 'semanal', 'hebdomadaire',
  'haftalık', 'haftalik', 'woche', 'wochentlich', 'settimanale',
];

const educationalStarts = [
  'what is', 'what are', 'why', 'how do', 'how does', 'tell me about',
  'ما هو', 'ما هي', 'لماذا', 'كيف',
  'что такое', 'почему', 'как выполнить',
  'que es', 'por que', 'como hago', "qu'est-ce", 'pourquoi', 'comment faire',
  'nedir', 'neden', 'nasil yapilir', 'was ist', 'warum', 'wie mache',
  "cos'e", 'cosa e', 'perche', 'come faccio', 'o que e', 'como faco',
];

const containsAny = (text: string, terms: string[]) => terms.some(term => text.includes(normalize(term)));

export function isPlanGenerationRequest(message: string): boolean {
  const text = normalize(message);
  if (!text) return false;

  const explanation = containsAny(text, explanationTerms);
  const injection = /(ignore|pretend|role.?play|story|fiction|игнор|притвор|تجاهل|تظاهر).{0,100}(plan|program|schedule|routine|خطة|برنامج|جدول|план|программ)/u.test(text);
  const chained = explanation && /(then|ثم|потом|luego|puis|sonra|dann|poi|depois).{0,80}(create|generate|answer|اعمل|انشئ|созда|состав|crea|fais|olustur|erstelle|fammi|crie)/u.test(text);
  if (explanation && !injection && !chained) return false;

  const noun = containsAny(text, planNouns);
  const domain = containsAny(text, fitnessDomains);
  const create = containsAny(text, createTerms);
  const duration = containsAny(text, durationTerms);
  if (educationalStarts.some(prefix => text.startsWith(normalize(prefix))) && !create) return false;
  return injection || chained || (noun && domain && create) || (noun && domain) || (create && domain && duration);
}

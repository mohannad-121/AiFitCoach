import { FormEvent, useEffect, useRef, useState } from 'react';
import { Bot, Loader2, Send, User, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuth } from '@/hooks/useAuth';
import { useUser } from '@/contexts/UserContext';
import { AI_BACKEND_URL } from '@/lib/backendUrl';
import { getTextDirection, repairMojibake } from '@/lib/text';
import { cn } from '@/lib/utils';

export interface LiveSessionContext {
  exercise: string;
  elapsed_seconds: number;
  camera_active: boolean;
  pose_analysis_ready: boolean;
  current_feedback: { level: string; cue: string; score: number | null };
  analyzed_samples: number;
  correct_sample_ratio: number | null;
  recurring_corrections: Array<{ cue: string; samples: number }>;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface LiveCoachChatProps {
  getSessionContext: () => LiveSessionContext;
  language: 'en' | 'ar';
}

const starterMessages = {
  en: 'I can use your live form results to explain corrections and recommend what to do next.',
  ar: 'يمكنني استخدام نتائج أدائك المباشرة لشرح التصحيحات واقتراح الخطوة التالية.',
};

export function LiveCoachChat({ getSessionContext, language }: LiveCoachChatProps) {
  const { user } = useAuth();
  const { profile } = useUser();
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: 'welcome', role: 'assistant', content: starterMessages[language] },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const conversationId = useRef(`live-coach-${user?.id || 'local'}-${Date.now()}`);
  const requestController = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isArabic = language === 'ar';

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => () => requestController.current?.abort(), []);

  const sendMessage = async (override?: string) => {
    const content = (override ?? input).trim();
    if (!content || loading) return;

    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: 'user', content };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput('');
    setLoading(true);
    setError('');

    const controller = new AbortController();
    requestController.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 60000);

    try {
      const liveSession = getSessionContext();
      const response = await fetch(`${AI_BACKEND_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        signal: controller.signal,
        body: JSON.stringify({
          message: content,
          user_id: user?.id || 'live-coach-local-user',
          conversation_id: conversationId.current,
          language,
          user_profile: profile,
          recent_messages: nextMessages.slice(-8).map(({ role, content: messageContent }) => ({ role, content: messageContent })),
          website_context: {
            app_name: 'FitCoach',
            current_page: 'live_coach',
            live_session: liveSession,
            coaching_instruction: 'Use live_session as measured pose telemetry. Be concise, prioritize the recurring correction, and do not claim to see the user or diagnose injury.',
          },
        }),
      });
      if (!response.ok) throw new Error(`Backend error: ${response.status}`);
      const data = await response.json();
      const reply = repairMojibake(String(data?.reply || '')).trim();
      if (!reply) throw new Error('Empty response');
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'assistant', content: reply }]);
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === 'AbortError') {
        setError(isArabic ? 'استغرق رد المدرب وقتًا طويلًا.' : 'The coach took too long to respond.');
      } else {
        setError(isArabic ? 'تعذر الاتصال بالمدرب.' : 'Could not reach the coach.');
      }
    } finally {
      window.clearTimeout(timeout);
      requestController.current = null;
      setLoading(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    sendMessage();
  };

  const suggestions = isArabic
    ? ['كيف هو أدائي؟', 'ما أهم تصحيح الآن؟', 'أعطني نسخة أسهل', 'اشرح الخطأ']
    : ['How is my form?', 'What should I fix first?', 'Give me a safer variation', 'Explain my mistake'];

  return (
    <section className="overflow-hidden rounded-[28px] border border-border bg-card shadow-sm ">
      <div className="border-b border-border px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-emerald-300/20 bg-gradient-to-br from-emerald-500/25 via-blue-500/20 to-cyan-400/20 shadow-sm">
            <Bot className="h-5 w-5 text-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground">{isArabic ? 'المدرب الذكي المباشر' : 'Live AI Coach'}</h2>
              <span className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-700">
                {isArabic ? 'مدرك للجلسة' : 'Session-aware'}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {isArabic ? 'يعتمد على بيانات الجلسة الحالية لتصحيح الأداء بسرعة.' : 'Uses your live session context to explain corrections quickly.'}
            </p>
          </div>
        </div>
      </div>

      <ScrollArea className="h-80">
        <div className="space-y-4 p-4">
          {messages.map((message) => (
            (() => {
              const messageDir = getTextDirection(message.content);
              return (
                <div key={message.id} className={cn('flex gap-3', message.role === 'user' && 'justify-end')}>
                  {message.role === 'assistant' && <Bot className="mt-1 h-4 w-4 shrink-0 text-cyan-700" />}
                  <div className={cn(
                    'max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-7 shadow-sm',
                    message.role === 'user'
                      ? 'border border-border bg-gradient-to-br from-emerald-500/90 via-blue-500/88 to-cyan-400/70 text-foreground'
                      : 'border border-border bg-muted/40 text-foreground'
                  )} dir={messageDir}>
                    <ReactMarkdown>{message.content}</ReactMarkdown>
                  </div>
                  {message.role === 'user' && <User className="mt-1 h-4 w-4 shrink-0 text-emerald-700/80" />}
                </div>
              );
            })()
          ))}
          {loading && (
            <div className="flex items-center gap-2 rounded-2xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-cyan-700" />
              {isArabic ? 'المدرب يحلل الجلسة الآن...' : 'The coach is analyzing your session...'}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      <div className="border-t border-border px-3 pt-3">
        <div className="mb-3 flex flex-wrap gap-2">
          {suggestions.map((suggestion) => (
            <Button key={suggestion} variant="outline" size="sm" className="h-8 rounded-full border-border bg-muted/40 px-3 text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground" onClick={() => sendMessage(suggestion)} disabled={loading}>
              {suggestion}
            </Button>
          ))}
        </div>
      </div>

      <form onSubmit={submit} className="flex gap-2 p-3">
        <Input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={isArabic ? 'اسأل عن أدائك...' : 'Ask about your form...'}
          disabled={loading}
          className="rounded-2xl border-border bg-muted/50"
        />
        <Button type="submit" size="icon" disabled={loading || !input.trim()} aria-label={isArabic ? 'إرسال' : 'Send'} className="rounded-2xl shadow-sm">
          <Send className="h-4 w-4" />
        </Button>
      </form>
      {error && <p className="px-3 pb-3 text-xs text-destructive">{error}</p>}
      <div className="px-3 pb-4">
        <div className="rounded-2xl border border-border bg-muted/40 px-3 py-2 text-[11px] text-cyan-700/80">
          <Sparkles className="mr-1 inline h-3.5 w-3.5" />
          {isArabic ? 'الردود تراعي الحركة الحالية والتمرين المختار والملاحظات المتكررة.' : 'Replies use your live motion state, selected exercise, and recurring corrections.'}
        </div>
      </div>
    </section>
  );
}

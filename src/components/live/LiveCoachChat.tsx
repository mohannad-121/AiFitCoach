import { FormEvent, useEffect, useRef, useState } from 'react';
import { Bot, Loader2, Send, User } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuth } from '@/hooks/useAuth';
import { useUser } from '@/contexts/UserContext';
import { AI_BACKEND_URL } from '@/lib/backendUrl';
import { repairMojibake } from '@/lib/text';
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
        setError(isArabic ? 'استغرق رد المدرب وقتاً طويلاً.' : 'The coach took too long to respond.');
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
    ? ['كيف هو أدائي؟', 'ما أهم تصحيح الآن؟']
    : ['How is my form?', 'What should I fix first?'];

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card/40">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Bot className="h-5 w-5 text-primary" />
        <div>
          <h2 className="text-sm font-semibold">{isArabic ? 'المدرب الذكي' : 'Live AI Coach'}</h2>
          <p className="text-xs text-muted-foreground">{isArabic ? 'متصل بنتائج الجلسة' : 'Session-aware'}</p>
        </div>
      </div>

      <ScrollArea className="h-72">
        <div className="space-y-3 p-4">
          {messages.map((message) => (
            <div key={message.id} className={cn('flex gap-2', message.role === 'user' && 'justify-end')}>
              {message.role === 'assistant' && <Bot className="mt-1 h-4 w-4 shrink-0 text-primary" />}
              <div className={cn(
                'max-w-[88%] rounded-lg px-3 py-2 text-sm leading-6',
                message.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground'
              )}>
                <ReactMarkdown>{message.content}</ReactMarkdown>
              </div>
              {message.role === 'user' && <User className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />}
            </div>
          ))}
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {isArabic ? 'جارٍ التفكير...' : 'Thinking...'}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      <div className="flex flex-wrap gap-2 border-t border-border px-3 pt-3">
        {suggestions.map((suggestion) => (
          <Button key={suggestion} variant="outline" size="sm" className="h-7 text-xs" onClick={() => sendMessage(suggestion)} disabled={loading}>
            {suggestion}
          </Button>
        ))}
      </div>

      <form onSubmit={submit} className="flex gap-2 p-3">
        <Input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={isArabic ? 'اسأل عن أدائك...' : 'Ask about your form...'}
          disabled={loading}
        />
        <Button type="submit" size="icon" disabled={loading || !input.trim()} aria-label={isArabic ? 'إرسال' : 'Send'}>
          <Send className="h-4 w-4" />
        </Button>
      </form>
      {error && <p className="px-3 pb-3 text-xs text-destructive">{error}</p>}
    </section>
  );
}

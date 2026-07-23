import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, beforeEach } from 'vitest';
import { LanguageProvider, useLanguage } from '@/contexts/LanguageContext';

function LanguageProbe() {
  const { dir, language, setLanguage, t } = useLanguage();

  return (
    <>
      <p data-testid="language">{language}</p>
      <p data-testid="direction">{dir}</p>
      <p data-testid="home-label">{t('nav.home')}</p>
      <button type="button" onClick={() => setLanguage(language === 'en' ? 'ar' : 'en')}>
        Toggle language
      </button>
    </>
  );
}

describe('LanguageProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.lang = '';
    document.documentElement.dir = '';
  });

  it('switches translations and document direction between English and Arabic', async () => {
    render(
      <LanguageProvider>
        <LanguageProbe />
      </LanguageProvider>
    );

    expect(screen.getByTestId('language')).toHaveTextContent('en');
    expect(screen.getByTestId('home-label')).toHaveTextContent('Home');

    fireEvent.click(screen.getByRole('button', { name: 'Toggle language' }));

    await waitFor(() => {
      expect(screen.getByTestId('language')).toHaveTextContent('ar');
      expect(screen.getByTestId('direction')).toHaveTextContent('rtl');
      expect(screen.getByTestId('home-label')).toHaveTextContent('الرئيسية');
      expect(document.documentElement.lang).toBe('ar');
      expect(document.documentElement.dir).toBe('rtl');
      expect(localStorage.getItem('fitcoach_language')).toBe('ar');
    });
  });
});

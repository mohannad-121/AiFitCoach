import { describe, expect, it } from 'vitest';
import { resolveConfiguredBackendUrl } from '@/lib/backendUrl';

describe('resolveConfiguredBackendUrl', () => {
  it('uses the live Render backend when the unconfigured API subdomain is supplied', () => {
    expect(resolveConfiguredBackendUrl('https://api.aifitcoach.dev/')).toBe(
      'https://fit-coach-ai-backend-ms4i.onrender.com'
    );
  });

  it('preserves other configured backend URLs', () => {
    expect(resolveConfiguredBackendUrl('https://example.com/api/')).toBe('https://example.com/api');
  });
});

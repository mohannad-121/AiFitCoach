import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.fitcoach.ai',
  appName: 'FitCoach AI',
  webDir: 'dist',
  backgroundColor: '#050510',
  android: {
    allowMixedContent: true,
    backgroundColor: '#050510',
  },
  ios: {
    backgroundColor: '#050510',
    contentInset: 'automatic',
  },
};

export default config;

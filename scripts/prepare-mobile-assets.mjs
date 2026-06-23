import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

// Workout videos are delivered separately on mobile to keep the native binary
// within practical emulator and app-store size limits.
for (const videoDirectory of [
  resolve('dist', 'videos'),
  resolve('android', 'app', 'src', 'main', 'assets', 'public', 'videos'),
  resolve('ios', 'App', 'App', 'public', 'videos'),
]) {
  rmSync(videoDirectory, { recursive: true, force: true });
}
console.log('Prepared mobile assets: excluded bundled workout videos.');

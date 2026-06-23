# FitCoach AI Mobile

The React application is packaged for Android and iOS with Capacitor.

## Android development

1. Install Android Studio, its SDK, and a JDK supported by the installed Android Gradle Plugin.
2. Set `ANDROID_HOME` to the Android SDK directory and add `platform-tools` to `PATH`.
3. Start the FastAPI backend on port `8012`.
4. Run `npm run mobile:android:run`.

The Android emulator reaches the computer backend through `http://10.0.2.2:8012` by default.
A physical phone cannot use that address; set `VITE_AI_BACKEND_URL` to a reachable HTTPS URL before building.

Native builds exclude the large local `public/videos` library to keep APK/AAB size practical.
Production exercise videos should be served from the deployed backend or an object-storage CDN.

## iOS development

iOS builds require macOS with Xcode. On the Mac, run `npm install`, then `npm run mobile:ios`.

## Release configuration

1. Copy `.env.mobile.example` to `.env.production.local` and set the deployed HTTPS API URL.
2. Run `npm run mobile:sync`.
3. Build a signed Android App Bundle in Android Studio or an iOS archive in Xcode.
4. Replace development icons, verify privacy disclosures, and complete store signing and listings.

Camera video is processed live in the WebView and is not recorded by the app.

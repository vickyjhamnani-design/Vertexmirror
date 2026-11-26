# BetMirror

Click a bet in Chrome on the PC and the same bet is clicked in the phone app.
PC and phone talk directly over your Wi-Fi (`ws://PHONE_IP:8765`). No server, no internet service in between.

```
Chrome on PC  --(extension)-->  ws://phone:8765  -->  BetMirror app (WebView with the same site)
```

## 1. Phone app (`android/`)

1. Install Android Studio on the PC.
2. File > Open > choose the `android` folder. Let it sync (accept any Gradle/plugin upgrade it offers).
3. Build > Build App Bundle(s) / APK(s) > Build APK(s).
4. Copy `android/app/build/outputs/apk/debug/app-debug.apk` to the phone and install it.
5. Open BetMirror. The bar under the address box shows `IP ... code ...`.
6. Type the site address, tap Go, log in, open the match.

## 2. Chrome extension (`extension/`)

1. Chrome > `chrome://extensions` > turn on Developer mode > Load unpacked > choose the `extension` folder.
2. Click the BetMirror icon. Enter the phone's IP and code, press **Save & connect**. The badge turns green **ON**.
3. Press **Send test**. The phone shows "Test received from PC".
4. Open the betting site on the PC, click the icon again and tick **Mirror clicks on <site>**.

## 3. Use

Open the same match on both. On the PC:

- click a back/lay price -> the phone clicks the same runner, market and side
- press Submit / Place Bet -> the phone fills the same stake and presses its own button
- press Reset / Cancel -> the phone clears its slip

Untick **Auto place** in the app if the phone should only select and fill the stake, leaving the last tap to you.
The popup shows what was sent and what the phone answered (for example `✗ runner not found`).

## If it does not connect

- Both devices on the same Wi-Fi, and the router must not have "AP / client isolation" on.
- From the PC browser open `http://PHONE_IP:8765`. It should say "BetMirror is reachable".
- The app must be open on screen (it keeps the screen on).
- The phone's IP can change after a router restart; the app always shows the current one.

## Limits

- Matching is by runner name + market title + back/lay, using the page's `back` / `lay` class names.
  A site that names things differently needs its selectors added in `core.js`
  (the same file is in `extension/` and `android/app/src/main/assets/`; keep the two copies identical).
- Clicks older than 1.5 s are dropped rather than delivered late.
- Markets inside an iframe on the phone page are not reached.
- Anyone on your Wi-Fi who knows the 4-digit code could send clicks, so use it on your own network.

## Tests (`test/`)

```
cd test && npm install
node core.test.js ../extension/core.js     # desktop markup -> mobile markup matching
```

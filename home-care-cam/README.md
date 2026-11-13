# Home Care Cam (घर का कैमरा)

Ghar ke Android phone ka camera apne office ke phone/computer ke browser me live dekhne ke liye.
Mummy ki permission aur jaankari ke saath use karein.

```
Ghar ka phone  (/camera)  ⇄  WebRTC (peer-to-peer, TURN fallback)  ⇄  Aapka browser  (/)
                      └── chhota server: login + handshake + alerts ──┘
```

## Features
- Live video + awaaz, kahin se bhi (password se login)
- Front / back camera badalna
- Push-to-talk: aap daba kar bolein, ghar ke phone se awaaz aayegi
- Mummy ka **"Roken" button** (30 min baad apne aap resume) — viewer par "mummy ne camera roka" dikhta hai
- "Aakhri hilchal" + battery + online/offline status
- Telegram alert: camera offline, X ghante koi hilchal nahi, battery kam
- Phone par koi hidden recording/hidden mode **nahi** hai; Android ka camera indicator hamesha dikhega (OS ka rule).

## Deploy (Render.com — free plan chalta hai, HTTPS zaroori hai)
1. Is repo ko Render me "Blueprint" se connect karein (`home-care-cam/render.yaml`) ya Web Service banayein:
   Root Directory `home-care-cam`, Build `npm install`, Start `node server.js`.
2. Environment variables:
   | Name | Meaning |
   |---|---|
   | `VIEW_PASSWORD` | aapka login password (lamba rakhein) |
   | `CAMERA_KEY` | ghar ke phone ki secret chaabi (lambi random string) |
   | `ICE_SERVERS` | (recommended) TURN servers JSON, neeche dekhein |
   | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | (optional) phone par alert |
   | `NO_MOTION_HOURS` (4), `OFFLINE_MINUTES` (5), `LOW_BATTERY` (20) | (optional) |
3. **TURN server** (zaroori agar office ka network strict ho): metered.ca / Cloudflare Calls / Twilio par free TURN lein, phir
   `ICE_SERVERS=[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:HOST:443?transport=tcp","username":"U","credential":"P"}]`
4. Telegram: @BotFather se bot banayein → token; bot ko message bhejein → `https://api.telegram.org/bot<TOKEN>/getUpdates` se `chat.id` lein.

## Ghar ke phone par (ek baar)
1. Android Chrome me kholein: `https://<your-app>/camera?key=<CAMERA_KEY>`
2. "Camera shuru karein" dabayein, camera/mic allow karein. Chrome menu → "Add to Home screen".
3. Phone ko **charger par**, Wi-Fi on, battery saver off rakhein. Screen on rahegi (WakeLock) — isliye ye phone alag, purana phone ho to behtar.
4. Phone ko hall jaisi jagah rakhein; bedroom/bathroom ke private hisse ki taraf nahi.

## Aapke phone/PC par
`https://<your-app>/` kholein → password → live dekhein.

## Limits (v1, web)
- Browser camera tabhi chalta hai jab ye page screen par khula ho. Doosre apps ke saath background me / screen band hone par Chrome camera band kar deta hai.
  Iska poora hal: Android app (foreground service) — next step.
- Heart-attack jaisi medical emergency camera detect nahi karta. Smartwatch (fall detection/SOS) aur emergency contact bhi rakhein.

## Local run / test
```
npm install
VIEW_PASSWORD=x CAMERA_KEY=y node server.js     # http://localhost:3000
npm test                                        # needs playwright (Chromium)
```

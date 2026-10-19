# VexDial — Solana Wallet-to-Wallet Encrypted Calls

**Your wallet is the phone number.**

Unlimited free audio & video calls between Solana wallets.  
End-to-end encrypted via WebRTC (DTLS-SRTP). Dark neon UI.  
Built by Vexlore.

Calls are pure peer-to-peer. Signaling server only exchanges addresses + SDP/ICE (no media). Zero on-chain fees for the call itself.

---

## Features

- Connect Phantom / Solflare → call by address or `.sol` / `.sns` domain
- Audio + Video, mute, camera toggle
- Accept / Reject incoming
- In-call reactions + text chat
- Recent contacts (localStorage)
- Share call link (`?call=address`)
- Online presence indicators
- Dark glass + neon UI

---

## Local Development

### Backend
```bash
cd backend
npm install
node server.js
# → http://localhost:3001
```

### Frontend
```bash
cd frontend
npm install
echo "NEXT_PUBLIC_SIGNALING_URL=http://localhost:3001" > .env.local
npm run dev
# → http://localhost:3000
```

Open two browsers, connect two wallets, call.

---

## Deploy for Public Use

### 1. Signaling Server (required — long-running process)

**Recommended: Render or Railway (free tier works)**

1. Push this repo to GitHub.
2. Create a new **Web Service** on [Render](https://render.com) or [Railway](https://railway.app).
3. Root directory: `backend`
4. Build command: `npm install`
5. Start command: `node server.js`
6. Environment: `PORT=10000` (or whatever the platform gives)
7. Deploy → get public URL e.g. `https://vexdial-signaling.onrender.com`

Socket.io works out of the box on both platforms. Free tiers may sleep after inactivity (Render).

### 2. Frontend (Next.js)

**Vercel (easiest)**

1. Import the repo on [Vercel](https://vercel.com).
2. Root directory: `frontend`
3. Add environment variable:
   - `NEXT_PUBLIC_SIGNALING_URL` = your signaling URL from above (no trailing slash)
4. Deploy.

### 3. Done

Users visit your Vercel URL → connect wallet → call any other connected wallet.

---

## Notes for Production

- **TURN server**: Current setup uses public STUN only. Some strict NATs will fail. For reliability add a TURN (Metered, Twilio, or self-hosted coturn). Update `ICE_SERVERS` in `frontend/src/hooks/useWebRTC.ts`.
- **SNS**: Uses `@bonfida/spl-name-service`. Needs a good RPC (mainnet-beta public is rate-limited; use Helius/QuickNode for production).
- **Scaling**: In-memory presence works for small scale. For many concurrent users move presence/rooms to Redis.
- **Security**: Signaling sees addresses + SDP. Media is E2E encrypted by WebRTC. Consider rate-limiting the signaling server.
- **Mobile**: Works in mobile browsers that support WebRTC + wallet adapter (Phantom mobile works).

---

## Project Structure

```
solana-wallet-call/
├── backend/
│   └── server.js              # Socket.io signaling + presence + chat + reactions
├── frontend/
│   ├── src/
│   │   ├── app/               # Next.js app
│   │   ├── components/
│   │   ├── hooks/useWebRTC.ts # Full WebRTC logic
│   │   └── lib/sns.ts         # .sol / .sns resolver
│   └── package.json
└── README.md
```

VexDial by Vexlore. Peer-to-peer. Encrypted. Free.

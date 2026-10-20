# VexDial

**Wallet-to-wallet encrypted calls.**

Your Solana wallet is your phone number.

Unlimited free audio and video calls between Solana wallets. End-to-end encrypted via WebRTC. Dark neon UI.

**Powered by Vexlore**

---

## Features

- Connect Phantom or Solflare
- Call by wallet address
- **VexVoice** (audio) and **VexVideo** (video)
- Accept / Reject incoming calls
- Ringtone and ringback
- In-call chat
- Screen share
- VexBook (contacts)
- Call history
- @VexDial on X

---

## Live

Frontend: [vexdial-3gfh-xi.vercel.app](https://vexdial-3gfh-xi.vercel.app)

---

## Local Development

### Backend
```bash
cd backend
npm install
node server.js
```

### Frontend
```bash
cd frontend
npm install
echo "NEXT_PUBLIC_SIGNALING_URL=http://localhost:3001" > .env.local
npm run dev
```

---

## Deploy

### Signaling (Render)
- Root: `backend`
- Start: `node server.js`

### Frontend (Vercel)
- Root: `frontend`
- Env: `NEXT_PUBLIC_SIGNALING_URL` = your Render URL

---

## Notes

- Media is peer-to-peer and encrypted
- Signaling server only exchanges connection data
- Free hosting may sleep after inactivity
- Wallet browsers can block camera/mic — use Chrome or Safari for best results

---

VexDial by Vexlore. Peer-to-peer. Encrypted. Free.

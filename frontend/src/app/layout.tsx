import './globals.css';
import { WalletProvider } from '../components/WalletProvider';

export const metadata = {
  title: 'VexDial — Wallet to Wallet Encrypted Calls',
  description: 'Your Solana wallet is the phone number. Free E2E encrypted audio & video calls. Built by Vexlore.'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}

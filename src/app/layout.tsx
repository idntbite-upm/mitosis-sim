// Create or modify src/app/layout.tsx
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Immersive Mitosis Lab',
  description: 'Interactive 3D simulation of cellular mitosis',
  icons: {
    icon: '/favicon.ico',
    apple: '/apple-icon.png', // Optional: add this if you have an apple icon
  }
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
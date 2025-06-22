// src/app/page.tsx
import MitosisSimulator from '@/components/ImmersiveMitosisLab';

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-blue-50 to-indigo-100 py-12">
      <MitosisSimulator />
    </main>
  );
}
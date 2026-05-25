import { useState } from 'react';
import LiveTraining from './components/LiveTraining';
import History from './components/History';

type Tab = 'live' | 'history';

export default function App() {
  const [tab, setTab] = useState<Tab>('live');

  return (
    <div className="app">
      {tab === 'live' ? <LiveTraining /> : <History />}
      <nav className="tabbar">
        <button
          type="button"
          className={`tab ${tab === 'live' ? 'tab--active' : ''}`}
          onClick={() => setTab('live')}
        >
          <span aria-hidden>🏋️</span>
          <span>Train</span>
        </button>
        <button
          type="button"
          className={`tab ${tab === 'history' ? 'tab--active' : ''}`}
          onClick={() => setTab('history')}
        >
          <span aria-hidden>📈</span>
          <span>History</span>
        </button>
      </nav>
    </div>
  );
}

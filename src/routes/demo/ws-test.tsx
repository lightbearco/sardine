import { createFileRoute } from '@tanstack/react-router'
import { useSimControls } from '#/hooks/useSimControls'
import { useAgentFeed } from '#/hooks/useAgentFeed'
import { useMarketData } from '#/hooks/useMarketData'

// @ts-ignore
export const Route = createFileRoute('/demo/ws-test')({
  component: WsTestComponent,
})

function WsTestComponent() {
  const { simState, isConnected, play, pause } = useSimControls();
  const { decisions } = useAgentFeed(5);
  const { lastBar } = useMarketData('AAPL');

  return (
    <div className="p-8 text-white min-h-screen bg-slate-900">
      <h1 className="text-3xl font-bold mb-4">WebSocket Integration Test</h1>
      
      <div className="flex items-center gap-4 mb-8">
        <div className={`px-3 py-1 rounded text-sm font-medium ${isConnected ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
          {isConnected ? 'Connected' : 'Disconnected'}
        </div>
        <div className={`px-3 py-1 rounded text-sm font-medium ${simState?.isRunning ? 'bg-emerald-500/20 text-emerald-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
          {simState?.isRunning ? 'Playing' : 'Paused'}
        </div>
        <button type="button" onClick={() => play()} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded font-medium">
          Play Engine
        </button>
        <button type="button" onClick={() => pause()} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded font-medium">
          Pause Engine
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="p-4 bg-slate-800 rounded-xl border border-slate-700">
          <h2 className="text-xl font-semibold mb-4 text-slate-300">Tick Summary State</h2>
          <pre className="text-sm bg-slate-900 p-4 rounded overflow-auto max-h-64 text-green-300">
            {JSON.stringify(simState, null, 2) || "No tick summary received yet..."}
          </pre>
        </div>

        <div className="space-y-8">
          <div className="p-4 bg-slate-800 rounded-xl border border-slate-700">
            <h2 className="text-xl font-semibold mb-4 text-slate-300">AAPL Market Data</h2>
            <pre className="text-sm bg-slate-900 p-4 rounded text-blue-300">
              {JSON.stringify(lastBar, null, 2) || "No AAPL OHLCV data yet..."}
            </pre>
          </div>

          <div className="p-4 bg-slate-800 rounded-xl border border-slate-700">
            <h2 className="text-xl font-semibold mb-4 text-slate-300">Latest Agent Feed</h2>
            <ul className="space-y-2">
              {decisions.length === 0 && <li className="text-slate-500">Wait for agent orders...</li>}
              {decisions.map((s, i) => (
                <li key={`${s.agentName}-${s.symbol}-${i}`} className="bg-slate-900 p-2 rounded text-sm flex justify-between border-l-4 border-l-purple-500">
                  <span className="font-semibold text-purple-300">{s.agentName}</span>
                  <span className={s.side === 'buy' ? 'text-green-400' : 'text-red-400'}>
                    {s.side.toUpperCase()} {s.qty} {s.symbol}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

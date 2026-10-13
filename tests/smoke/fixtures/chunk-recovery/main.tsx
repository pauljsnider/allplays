import React, { Suspense, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { lazyNamedPage } from '../../../../apps/app/src/lib/lazyPage';
const Player = lazyNamedPage(() => import('./PlayerDetail'), 'PlayerDetail');
class Boundary extends React.Component<{children: React.ReactNode}, {failed: boolean}> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p role="alert">Load failed</p> : this.props.children; }
}
function App() {
  const [open, setOpen] = useState(false);
  return <><input aria-label="Unsaved note" /><button onClick={() => setOpen(true)}>Open player</button>
    <Boundary><Suspense fallback={<p>Loading player</p>}>{open && <Player />}</Suspense></Boundary></>;
}
createRoot(document.getElementById('root')!).render(<App />);

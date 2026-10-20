import { createRoot } from 'react-dom/client';
import App from './App.js';
import { fxBus } from './fx/bus.js';
import { sound } from './audio/sound.js';
import './styles/base.css';
import './styles/cards.css';
import './styles/table.css';
import './styles/ui.css';

// one place wires the effect stream into the synth
fxBus.on((fx) => {
  if (fx.kind === 'sound') sound.play(fx.name, fx.gain ?? 1);
});

const el = document.getElementById('root');
if (!el) throw new Error('missing #root');
createRoot(el).render(<App />);

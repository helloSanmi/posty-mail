import { createRoot } from 'react-dom/client';
import { Sandbox } from './Sandbox';

// Entry for design.html only. src/main.jsx (the real app) does not import
// anything from src/design/, and the production build has no entry that
// reaches this file.
createRoot(document.getElementById('design-root')).render(<Sandbox />);

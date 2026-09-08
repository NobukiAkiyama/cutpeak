// Public application facade. UI modules retain this import path while each
// responsibility lives in a focused controller or service.
export { useEditor, type Panel, type State } from './editor-state';
export { api, setStopPlayback } from './editor-actions';
export { notify } from './notifications';
export { persistNow } from './persistence-controller';
export {
  hydrateMedia,
  importFiles,
  media,
  projectFiles,
} from './media-import-service';
export {
  bootstrap,
  deleteProject,
  newProject,
  openProject,
} from './project-session';

import { installPagePersistence } from './persistence-controller';

installPagePersistence();

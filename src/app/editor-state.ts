import { create } from 'zustand';
import { Editor, type Repository } from '../core/history';
import { makeProject, type Project } from '../core/model';
import { type CapabilityProfile } from './capabilities';
import { type ProjectIndex } from '../storage/local';

export type Panel = 'media' | 'audio' | 'text' | 'captions' | 'elements';
export type AssetIssue =
  | 'missing-local-file'
  | 'drive-download-failed'
  | 'media-registration-failed';

export interface State {
  editor: Editor;
  project: Project;
  repository: Repository;
  revision: number;
  selected: string | null;
  frame: number;
  playing: boolean;
  ready: boolean;
  panel: Panel;
  zoom: number;
  snapping: boolean;
  quality: 'auto' | 'full' | 'half' | 'quarter';
  saveStatus: 'saved' | 'saving' | 'error';
  updateAvailable: boolean;
  notice: string;
  busy: string;
  capabilities: CapabilityProfile | null;
  offline: string[];
  assetIssues: Record<string, AssetIssue>;
  projects: ProjectIndex[];
  mobilePanel: boolean;
  inspectorOpen: boolean;
}

const initial = new Editor(makeProject());

export const useEditor = create<State>(() => ({
  editor: initial,
  project: initial.project,
  repository: initial.repository,
  revision: 0,
  selected: null,
  frame: 0,
  playing: false,
  ready: false,
  panel: 'media',
  zoom: 1.8,
  snapping: true,
  quality: 'auto',
  saveStatus: 'saved',
  updateAvailable: false,
  notice: '',
  busy: '',
  capabilities: null,
  offline: [],
  assetIssues: {},
  projects: [],
  mobilePanel: false,
  inspectorOpen: false,
}));

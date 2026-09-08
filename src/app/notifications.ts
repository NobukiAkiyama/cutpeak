import { useEditor } from './editor-state';

let noticeTimer: ReturnType<typeof setTimeout> | undefined;

export function notify(notice: string) {
  clearTimeout(noticeTimer);
  useEditor.setState({ notice });
  noticeTimer = setTimeout(() => useEditor.setState({ notice: '' }), 6500);
}

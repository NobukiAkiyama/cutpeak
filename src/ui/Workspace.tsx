import { Fragment, type ReactNode } from 'react';
import { PanelsTopLeft, RotateCcw, X } from 'lucide-react';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { useEditor } from '../app/store';
import { usePanelLayout, panelNames, type PanelId } from './workspace-state';
import Library from './Library';
import Preview from './Preview';
import Inspector from './Inspector';
import Timeline, { TimelineControls } from './Timeline';

export function WorkspaceMenu() {
  const { visible, show, reset } = usePanelLayout();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="workspace-menu-trigger"
        title="パネルの表示と配置"
        aria-label="パネルの表示と配置"
      >
        <PanelsTopLeft size={18} />
        <span>表示</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="workspace-menu" align="end">
        {(Object.keys(panelNames) as PanelId[]).map((id) => (
          <DropdownMenuCheckboxItem
            key={id}
            checked={visible[id]}
            onCheckedChange={(open) => show(id, open)}
            closeOnClick={false}
          >
            {panelNames[id]}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={reset}>
          <RotateCcw size={16} />
          配置をリセット
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
function Pane({
  id,
  children,
  actions,
}: {
  id: PanelId;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const show = usePanelLayout((s) => s.show);
  return (
    <section
      className={`workspace-pane pane-${id}`}
      aria-label={`${panelNames[id]}パネル`}
    >
      <div className="pane-titlebar">
        <span>{panelNames[id]}</span>
        {actions && <div className="pane-titlebar-actions">{actions}</div>}
        <button
          title={`${panelNames[id]}を閉じる`}
          aria-label={`${panelNames[id]}を閉じる`}
          onClick={() => show(id, false)}
        >
          <X size={15} />
        </button>
      </div>
      <div className="pane-content">{children}</div>
    </section>
  );
}
export default function Workspace({ tablet }: { tablet: boolean }) {
  const { visible, layouts, saveLayout, generation, reset } = usePanelLayout();
  const { ready } = useEditor();
  const upperIds = (['library', 'preview', 'inspector'] as PanelId[]).filter(
    (id) => visible[id],
  );
  const columnKey = `${tablet ? 'compact' : 'desktop'}:${upperIds.join('|')}`;
  const rowKey = `rows:${upperIds.length > 0}:${visible.timeline}`;
  const contents: Record<string, ReactNode> = {
    library: <Library />,
    preview: <Preview />,
    inspector: (
      <aside className="inspector">
        <Inspector />
      </aside>
    ),
  };
  return (
    <div className="resizable-workspace" aria-busy={!ready}>
      {!upperIds.length && !visible.timeline ? (
        <div className="workspace-empty">
          <PanelsTopLeft size={32} />
          <p>すべてのパネルを閉じています</p>
          <button className="primary" onClick={reset}>
            標準の配置に戻す
          </button>
          <span>上部の「表示」から個別に開くこともできます。</span>
        </div>
      ) : (
        <ResizablePanelGroup
          key={generation}
          orientation="vertical"
          id="workspace-rows"
          defaultLayout={layouts[rowKey]}
          onLayoutChanged={(layout) => saveLayout(rowKey, layout)}
        >
          {upperIds.length > 0 && (
            <ResizablePanel id="upper" defaultSize="68%" minSize="25%">
              <ResizablePanelGroup
                orientation={tablet ? 'vertical' : 'horizontal'}
                id="workspace-columns"
                defaultLayout={layouts[columnKey]}
                onLayoutChanged={(layout) => saveLayout(columnKey, layout)}
              >
                {upperIds.map((id, index) => (
                  <Fragment key={id}>
                    {index > 0 && (
                      <ResizableHandle
                        className="workspace-divider"
                        withHandle
                        aria-label={
                          tablet ? 'パネルの高さを調整' : 'パネルの幅を調整'
                        }
                      />
                    )}
                    <ResizablePanel
                      id={id}
                      defaultSize={id === 'preview' ? '52%' : '24%'}
                      minSize={tablet ? '15%' : '14%'}
                    >
                      <Pane id={id}>{contents[id]}</Pane>
                    </ResizablePanel>
                  </Fragment>
                ))}
              </ResizablePanelGroup>
            </ResizablePanel>
          )}
          {upperIds.length > 0 && visible.timeline && (
            <ResizableHandle
              className="workspace-divider"
              withHandle
              aria-label="タイムラインの高さを調整"
            />
          )}
          {visible.timeline && (
            <ResizablePanel id="timeline" defaultSize="32%" minSize="18%">
              <Pane id="timeline" actions={<TimelineControls />}>
                <Timeline />
              </Pane>
            </ResizablePanel>
          )}
        </ResizablePanelGroup>
      )}
    </div>
  );
}

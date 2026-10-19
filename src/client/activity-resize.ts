import {workspaceRanges} from './workspace-settings.js';

interface ActivityResizeOptions {
  columns: HTMLElement;
  chat: HTMLElement;
  review: HTMLElement;
  activity: HTMLElement;
  separator: HTMLElement;
  getHeight: () => number;
  setHeight: (height: number) => void;
  persist: () => void;
}

export function initializeActivityResize(options: ActivityResizeOptions): {update: () => void} {
  const {columns,chat,review,activity,separator,getHeight,setHeight,persist} = options;
  let pointer: number | null = null;
  let dragParent: HTMLElement | null = null;
  let previousHeight = getHeight();
  let startY = 0;
  let startHeight = 0;
  let currentHeight = getHeight();
  let minimum = 80;
  let maximum = 800;
  const pixels = (value: string) => parseFloat(value) || 0;
  const marginHeight = (node: HTMLElement) => {
    const style = getComputedStyle(node);
    return node.getBoundingClientRect().height + pixels(style.marginTop) + pixels(style.marginBottom);
  };
  const visibleChildren = (node: HTMLElement) => Array.from(node.children).filter((child): child is HTMLElement =>
    !('hidden' in child && child.hidden) && getComputedStyle(child).display !== 'none');
  const nested = () => !activity.hidden && columns.clientWidth > 0
    && (columns.dataset.activity === 'chat' || columns.dataset.activity === 'review')
    && (activity.parentElement === chat || activity.parentElement === review);
  const clamp = (height: number) => Math.max(minimum,Math.min(maximum,Math.round(height)));
  const setRequested = (height: number) => {
    const [low,high] = workspaceRanges.activityHeight;
    setHeight(Math.max(low,Math.min(high,Math.round(height))));
  };

  function endDrag(cancelled = false): void {
    if (pointer === null) return;
    const id = pointer;
    pointer = null;dragParent = null;
    document.body.classList.remove('resizing-activity');
    if (separator.hasPointerCapture(id)) separator.releasePointerCapture(id);
    if (cancelled) { setHeight(previousHeight);update(); }
    else persist();
  }

  function update(): void {
    const active = nested();
    if (pointer !== null && (!active || activity.parentElement !== dragParent)) endDrag(true);
    separator.hidden = !active;
    if (!active) return;
    const parent = activity.parentElement!;
    const parentStyle = getComputedStyle(parent);
    const activityStyle = getComputedStyle(activity);
    const children = visibleChildren(parent);
    const fixed = children.filter(child => child !== activity && child.id !== 'chat' && child.id !== 'reviews');
    const activityChildren = visibleChildren(activity);
    const chrome = activityChildren.filter(child => child.id !== 'activity-feed').reduce((height,child) => height + marginHeight(child),0)
      + pixels(activityStyle.paddingTop) + pixels(activityStyle.paddingBottom)
      + pixels(activityStyle.borderTopWidth) + pixels(activityStyle.borderBottomWidth)
      + Math.max(0,activityChildren.length - 1) * pixels(activityStyle.rowGap);
    minimum = Math.ceil(Math.max(workspaceRanges.activityHeight[0],chrome + 32));
    const available = parent.clientHeight - pixels(parentStyle.paddingTop) - pixels(parentStyle.paddingBottom)
      - fixed.reduce((height,child) => height + marginHeight(child),0)
      - Math.max(0,children.length - 1) * pixels(parentStyle.rowGap) - 96
      - pixels(activityStyle.marginTop) - pixels(activityStyle.marginBottom);
    maximum = Math.max(minimum,Math.min(workspaceRanges.activityHeight[1],Math.floor(available)));
    currentHeight = clamp(getHeight());
    activity.style.setProperty('--activity-size',`${currentHeight}px`);
    activity.style.setProperty('--activity-min-size',`${minimum}px`);
    separator.setAttribute('aria-valuemin',String(minimum));
    separator.setAttribute('aria-valuemax',String(maximum));
    separator.setAttribute('aria-valuenow',String(currentHeight));
    separator.setAttribute('aria-valuetext',`LIVE-activiteit ${currentHeight} pixels`);
  }

  separator.addEventListener('pointerdown',event => {
    update();
    if (!nested() || event.button !== 0 || pointer !== null) return;
    event.preventDefault();separator.focus();
    pointer = event.pointerId;dragParent = activity.parentElement;
    previousHeight = getHeight();startHeight = currentHeight;startY = event.clientY;
    separator.setPointerCapture(pointer);document.body.classList.add('resizing-activity');
  });
  separator.addEventListener('pointermove',event => {
    if (event.pointerId !== pointer) return;
    update();
    if (pointer === null) return;
    setRequested(clamp(startHeight + startY - event.clientY));update();
  });
  separator.addEventListener('pointerup',event => { if (event.pointerId === pointer) endDrag(); });
  separator.addEventListener('pointercancel',event => { if (event.pointerId === pointer) endDrag(true); });
  separator.addEventListener('lostpointercapture',() => endDrag(true));
  separator.addEventListener('dblclick',() => {
    update();if (!nested()) return;
    setRequested(220);update();persist();
  });
  separator.addEventListener('keydown',event => {
    if (event.key === 'Escape' && pointer !== null) { event.preventDefault();endDrag(true);return; }
    update();
    if (!nested() || !['ArrowUp','ArrowDown','Home','End','Enter'].includes(event.key)) return;
    event.preventDefault();
    if (pointer !== null) endDrag(true);
    setRequested(event.key === 'Enter' ? 220 : event.key === 'Home' ? minimum : event.key === 'End' ? maximum
      : clamp(currentHeight + (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 30 : 10)));
    update();persist();
  });
  const observer = new ResizeObserver(update);
  for (const parent of [chat,review]) {
    observer.observe(parent);
    for (const child of Array.from(parent.children)) {
      if (child !== activity && child !== separator && child.id !== 'chat' && child.id !== 'reviews') observer.observe(child);
    }
    parent.addEventListener('toggle',update,true);
  }
  for (const child of Array.from(activity.children)) if (child.id !== 'activity-feed') observer.observe(child);
  document.addEventListener('workspace-chrome-changed',update);
  return {update};
}

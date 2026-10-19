import {element,toast} from './dom.js';
import {normalizeWorkspace,workspaceFlow,workspacePreset,workspaceRanges} from './workspace-settings.js';
import type {WorkspaceSettings} from './workspace-settings.js';
import {initializeActivityResize} from './activity-resize.js';

const key = 'fay-workspace-layout';
const selectFields = {mode:'mode',visible:'visible',order:'order','stack-first':'stackFirst',activity:'activity'} as const;
const sizeFields = {share:'split','chat-height':'chatHeight','review-height':'reviewHeight',
  'activity-height':'activityHeight','activity-width':'activityWidth'} as const;

function load(): WorkspaceSettings {
  try {
    const saved = localStorage.getItem(key);
    return normalizeWorkspace(saved ? JSON.parse(saved) : {split:Number(localStorage.getItem('fay-chat-split')) || 53});
  } catch { return normalizeWorkspace(undefined); }
}

export function initializeWorkspace(): void {
  let settings = load();
  const columns = element('#chatpage');
  const chat = element('#chat-panel');
  const review = element('#review-panel');
  const activity = element('#activity-panel');
  const separator = element('#chat-resize');
  const activitySeparator = element('#activity-resize');
  const status = element('#layout-status');
  const menu = element<HTMLDetailsElement>('#layout-options');
  const displayMenu = element<HTMLDetailsElement>('.display-preferences');
  const closeMenu = () => { menu.open = false;element('#layout-options>summary').focus(); };
  element('#layout-close').onclick = closeMenu;
  menu.addEventListener('keydown',event => { if (event.key === 'Escape') { event.preventDefault();closeMenu(); } });
  menu.addEventListener('toggle',() => { if (menu.open) displayMenu.open = false; });
  displayMenu.addEventListener('toggle',() => { if (displayMenu.open) menu.open = false; });
  const persist = () => {
    try { localStorage.setItem(key,JSON.stringify(settings)); }
    catch { toast('De indeling is aangepast, maar kon niet worden bewaard.'); }
  };
  let currentSplit = settings.split;
  let pointer: number | null = null;
  let previousSplit = settings.split;

  const bounds = () => {
    const available = columns.clientWidth - separator.offsetWidth
      - (columns.dataset.activity === 'column'
        ? activity.getBoundingClientRect().width + (parseFloat(getComputedStyle(activity).marginLeft) || 0) : 0);
    const minimum = Math.min(45,300 / Math.max(1,available) * 100);
    return {available,minimum,maximum:100 - minimum};
  };
  const syncControls = () => {
    for (const [id,field] of Object.entries(selectFields)) element<HTMLSelectElement>(`#layout-${id}`).value = settings[field];
    for (const [id,field] of Object.entries(sizeFields)) {
      const input = element<HTMLInputElement>(`#layout-${id}`);
      input.value = String(settings[field]);
      element(`output[for="layout-${id}"]`).textContent = `${Math.round(settings[field])}${field === 'split' ? '%' : ' px'}`;
    }
  };
  const activityResize = initializeActivityResize({columns,chat,review,activity,separator:activitySeparator,
    getHeight:() => settings.activityHeight,
    setHeight:height => { settings.activityHeight = height;syncControls();element<HTMLSelectElement>('#layout-preset').value = ''; },persist});

  function apply(): void {
    syncControls();
    if (!columns.clientWidth) { activityResize.update();return; }
    const flow = workspaceFlow(settings,columns.clientWidth);
    const first = flow === 'stacked' ? settings.stackFirst : settings.order;
    const visible = settings.visible === 'both' ? [chat,review] : [settings.visible === 'chat' ? chat : review];
    let placement = settings.activity;
    if (placement === 'column' && (flow !== 'columns' || columns.clientWidth < 1180)) placement = 'bottom';
    if (placement === 'chat' && !visible.includes(chat)) placement = 'review';
    if (placement === 'review' && !visible.includes(review)) placement = 'chat';
    columns.dataset.flow = flow;
    columns.dataset.activity = activity.hidden ? 'none' : placement;
    chat.classList.toggle('layout-hidden',!visible.includes(chat));
    review.classList.toggle('layout-hidden',!visible.includes(review));
    const parent = placement === 'chat' ? chat : placement === 'review' ? review : columns;
    if (activity.parentElement !== parent || activitySeparator.parentElement !== parent) parent.append(activitySeparator,activity);
    const order = first === 'chat' ? [chat,separator,review] : [review,separator,chat];
    if (parent === columns) order.push(activitySeparator,activity);
    if (order.some((node,index) => columns.children[index] !== node)) columns.replaceChildren(...order);
    for (const [name,field] of Object.entries(sizeFields)) {
      if (field !== 'split') columns.style.setProperty(`--${name}`,`${settings[field]}px`);
    }
    const main = columns.parentElement!;
    const top = columns.getBoundingClientRect().top + main.scrollTop + window.scrollY;
    columns.style.setProperty('--workspace-height',`${Math.max(320,window.innerHeight - top - 16)}px`);
    const {minimum,maximum} = bounds();
    currentSplit = Math.max(minimum,Math.min(maximum,settings.split));
    const firstShare = first === 'chat' ? currentSplit : 100 - currentSplit;
    columns.style.setProperty('--first-share',`${firstShare}fr`);
    columns.style.setProperty('--second-share',`${100 - firstShare}fr`);
    separator.setAttribute('aria-valuemin',String(Math.floor(minimum)));
    separator.setAttribute('aria-valuemax',String(Math.ceil(maximum)));
    separator.setAttribute('aria-valuenow',String(Math.round(currentSplit)));
    separator.setAttribute('aria-valuetext',`Livechat ${Math.round(currentSplit)} procent`);
    element<HTMLInputElement>('#layout-share').disabled = flow !== 'columns';
    element<HTMLInputElement>('#layout-activity-width').disabled = columns.dataset.activity !== 'column';
    element<HTMLInputElement>('#layout-activity-height').disabled = Boolean(activity.hidden) || columns.dataset.activity === 'column';
    element<HTMLInputElement>('#layout-chat-height').disabled = flow !== 'stacked';
    element<HTMLInputElement>('#layout-review-height').disabled = flow !== 'stacked';
    status.textContent = flow === 'stacked' && settings.mode !== 'stacked'
      ? 'De panelen staan onder elkaar omdat de werkruimte smal is.'
      : settings.activity === 'column' && placement === 'bottom'
        ? 'LIVE-activiteit staat onderaan tot er ruimte is voor een derde kolom.'
        : 'Jouw indeling wordt in deze browser bewaard.';
    if (flow !== 'columns' && pointer !== null) endDrag(true);
    activityResize.update();
  }

  function endDrag(cancelled = false): void {
    if (pointer === null) return;
    const id = pointer;
    pointer = null;
    document.body.classList.remove('resizing-chat');
    if (separator.hasPointerCapture(id)) separator.releasePointerCapture(id);
    if (cancelled) { settings.split = previousSplit; apply(); }
    else persist();
  }

  for (const [id,field] of Object.entries(selectFields)) {
    element<HTMLSelectElement>(`#layout-${id}`).onchange = event => {
      settings = normalizeWorkspace({...settings,[field]:(event.target as HTMLSelectElement).value});
      element<HTMLSelectElement>('#layout-preset').value = '';
      apply();persist();
    };
  }
  for (const [id,field] of Object.entries(sizeFields)) {
    const input = element<HTMLInputElement>(`#layout-${id}`);
    const [minimum,maximum] = workspaceRanges[field];
    input.min = String(minimum);input.max = String(maximum);
    input.oninput = () => {
      settings = normalizeWorkspace({...settings,[field]:Number(input.value)});
      element<HTMLSelectElement>('#layout-preset').value = '';
      apply();
    };
    input.onchange = persist;
  }
  element<HTMLSelectElement>('#layout-preset').onchange = event => {
    const preset = workspacePreset((event.target as HTMLSelectElement).value);
    if (preset) { settings = preset;apply();persist(); }
  };
  const reset = () => { settings = normalizeWorkspace(undefined);apply();persist(); };
  element('#layout-reset').onclick = () => { element<HTMLSelectElement>('#layout-preset').value = '';reset(); };

  separator.addEventListener('pointerdown',event => {
    if (columns.dataset.flow !== 'columns' || event.button !== 0 || pointer !== null) return;
    event.preventDefault();separator.focus();pointer = event.pointerId;previousSplit = settings.split;
    separator.setPointerCapture(pointer);document.body.classList.add('resizing-chat');
  });
  separator.addEventListener('pointermove',event => {
    if (pointer !== event.pointerId || columns.dataset.flow !== 'columns') return;
    const {available,minimum,maximum} = bounds();
    const position = event.clientX - columns.getBoundingClientRect().left - separator.offsetWidth / 2;
    const share = position / Math.max(1,available) * 100;
    settings.split = Math.max(minimum,Math.min(maximum,settings.order === 'chat' ? share : 100 - share));
    apply();
  });
  separator.addEventListener('pointerup',event => { if (event.pointerId === pointer) endDrag(); });
  separator.addEventListener('pointercancel',() => endDrag(true));
  separator.addEventListener('lostpointercapture',() => endDrag());
  separator.addEventListener('dblclick',() => { settings.split = 53;apply();persist(); });
  separator.addEventListener('keydown',event => {
    if (event.key === 'Escape' && pointer !== null) { endDrag(true);return; }
    if (columns.dataset.flow !== 'columns' || !['ArrowLeft','ArrowRight','Home','End','Enter'].includes(event.key)) return;
    event.preventDefault();
    const {minimum,maximum} = bounds();
    const direction = settings.order === 'chat' ? 1 : -1;
    settings.split = event.key === 'Enter' ? 53 : event.key === 'Home' ? direction === 1 ? minimum : maximum
      : event.key === 'End' ? direction === 1 ? maximum : minimum
        : Math.max(minimum,Math.min(maximum,currentSplit + (event.key === 'ArrowLeft' ? -1 : 1) * direction * (event.shiftKey ? 10 : 2)));
    apply();persist();
  });
  const observer = new ResizeObserver(apply);
  for (const node of [columns,element('header'),element('.demo')]) observer.observe(node);
  new MutationObserver(apply).observe(activity,{attributes:true,attributeFilter:['hidden']});
  window.addEventListener('resize',apply);
  apply();
}

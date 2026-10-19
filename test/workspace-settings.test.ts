import test from 'node:test';
import assert from 'node:assert/strict';

const settings=await import(new URL('../dist/browser/client/workspace-settings.js',import.meta.url).href);

test('workspace preferences validate saved choices and bound all dimensions',()=>{
  assert.deepEqual(settings.normalizeWorkspace(null),settings.defaultWorkspace);
  assert.deepEqual(settings.normalizeWorkspace([]),settings.defaultWorkspace);
  assert.deepEqual(settings.normalizeWorkspace({mode:'invalid',activity:'invalid',split:'65',chatHeight:Infinity}),settings.defaultWorkspace);
  const value=settings.normalizeWorkspace({mode:'columns',visible:'review',order:'review',stackFirst:'review',activity:'column',
    split:99,chatHeight:0,reviewHeight:999999,activityHeight:-99,activityWidth:NaN});
  assert.deepEqual(value,{...settings.defaultWorkspace,mode:'columns',visible:'review',order:'review',stackFirst:'review',activity:'column',
    split:80,chatHeight:240,reviewHeight:960,activityHeight:120});
  const restored=settings.normalizeWorkspace(JSON.parse(JSON.stringify({...value,activityWidth:380})));
  assert.equal(restored.activityWidth,380);
});

test('layout follows workspace width and protects small screens even in side-by-side mode',()=>{
  const value=settings.defaultWorkspace;
  assert.equal(settings.workspaceFlow(value,959),'stacked');
  assert.equal(settings.workspaceFlow(value,960),'columns');
  assert.equal(settings.workspaceFlow({...value,mode:'columns'},759),'stacked');
  assert.equal(settings.workspaceFlow({...value,mode:'columns'},760),'columns');
  assert.equal(settings.workspaceFlow({...value,mode:'stacked'},1920),'stacked');
  assert.equal(settings.workspaceFlow({...value,visible:'chat'},375),'single');
  assert.equal(settings.workspaceFlow({...value,visible:'review'},1920),'single');
});

test('presets keep separate desktop and stacked ordering and return independent preferences',()=>{
  assert.equal(settings.workspacePreset('unknown'),undefined);
  const moderation=settings.workspacePreset('moderation')!;
  assert.equal(moderation.order,'review');assert.equal(moderation.stackFirst,'review');
  assert.equal(moderation.activity,'bottom');
  const three=settings.workspacePreset('three')!;
  assert.equal(three.activity,'column');assert.equal(three.mode,'columns');
  three.split=60;assert.equal(settings.workspacePreset('three')!.split,50);
  assert.equal(settings.workspacePreset('chat')!.split,65);
  assert.deepEqual(settings.workspacePreset('balanced'),settings.defaultWorkspace);
});

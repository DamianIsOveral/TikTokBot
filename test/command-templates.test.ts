import test from 'node:test';
import assert from 'node:assert/strict';
import {renderCommandTemplates,templateContext,maximumTemplateContext} from '../src/shared/command-templates.ts';
import {planResponses} from '../src/shared/command-policy.ts';
import {validateCommands} from '../src/server/command-validation.ts';
import {createCommands} from '../src/server/commands.ts';
import type {CommandDefinition} from '../src/shared/commands.ts';

const context={username:'viewer',displayname:'Kijker',channel:'faynominaal',command:'!discord'};
test('tags zijn letterlijke vervanging zonder code-uitvoering of recursie; namen zijn begrensd en zonder controletekens',()=>{
  assert.deepEqual(renderCommandTemplates(['Hey {username}: {displayname} bij {channel}, via {command}'],context),
    {responses:['Hey viewer: Kijker bij faynominaal, via !discord'],error:''});
  assert.equal(renderCommandTemplates(['Gewone tekst'],context).responses[0],'Gewone tekst');
  assert.ok(renderCommandTemplates(['{Date.now()}'],context).error);
  assert.ok(renderCommandTemplates(['{constructor} {__proto__}'],context).error);
  assert.equal(renderCommandTemplates(['{displayname}'],{...context,displayname:'{channel}'}).responses[0],'{channel}');
  const cleaned=templateContext({...context,displayname:'A\n\u202eB '+ '😀'.repeat(30),username:'bad\nname'});
  assert.equal(cleaned.username,'kijker');
  assert.ok(cleaned.displayname.length<=40);
  assert.ok(!/[\p{Cc}\p{Cf}]/u.test(cleaned.displayname));
  assert.ok(!/[\uD800-\uDBFF]$/.test(cleaned.displayname));
});

test('opslag valideert de langste tagwaarden; uitbreiding wordt vóór het splitsen uitgevoerd',async()=>{
  const definition:CommandDefinition={trigger:'!test',aliases:['!t'],enabled:true,cooldownSeconds:60,
    responses:['x'.repeat(140)+' {displayname}', '{username} {channel} {command}']};
  assert.deepEqual(validateCommands({revision:0,commands:[definition]}).commands[0],definition);
  assert.throws(()=>validateCommands({revision:0,commands:[{...definition,responses:Array(6).fill('x'.repeat(140)+' {displayname}') }]}));
  assert.throws(()=>validateCommands({revision:0,commands:[{...definition,responses:['{unknown}']}]}));
  const expanded=renderCommandTemplates(definition.responses,maximumTemplateContext);
  assert.equal(planResponses(expanded.responses).messages.length,3);
  let time=100_000;
  const sent:string[]=[];
  const process=createCommands({active:()=>true,botUsername:'bot',channel:'faynominaal',report:assert.fail,
    getCommands:()=>[definition],now:()=>time,wait:async ms=>{time+=ms;},send:async text=>{sent.push(text);}});
  await process({content:'!t',user:{uniqueId:'zeffuro',nickname:'😀'.repeat(25)}});
  assert.equal(sent.length,3);
  assert.ok(sent.every(text=>text.length<=150));
  assert.equal(sent.at(-1),'zeffuro faynominaal !test');
});

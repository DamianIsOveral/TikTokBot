export interface CommandTemplateContext { username: string; displayname: string; channel: string; command: string }
export const commandTags = ['username','displayname','channel','command'] as const;
export const maximumTemplateContext: CommandTemplateContext = {
  username:'u'.repeat(24),displayname:'N'.repeat(40),channel:'c'.repeat(24),command:'!'+ 'a'.repeat(30)
};
function boundedText(text: string, max: number): string {
  let result='';
  for(const character of text.normalize('NFC').replace(/[\p{Cc}\p{Cf}]/gu,' ').replace(/\s+/gu,' ').trim()) {
    if(result.length+character.length>max)break;
    result+=character;
  }
  return result;
}
export function templateContext(values: CommandTemplateContext): CommandTemplateContext {
  return {username:/^[\w.]{1,24}$/.test(values.username)?values.username:'kijker',
    displayname:boundedText(values.displayname,40)||'Kijker',
    channel:/^[\w.]{1,24}$/.test(values.channel)?values.channel:'kanaal',
    command:/^![a-z0-9_]{1,30}$/.test(values.command)?values.command:'!commando'};
}
export function renderCommandTemplates(responses: readonly string[], values: CommandTemplateContext) {
  const context=templateContext(values);
  let error='';
  const rendered=responses.map(source=>source.replace(/\{([^{}]*)\}/g,(_match,name:string)=>{
    if(!commandTags.includes(name as typeof commandTags[number])) {
      error='Onbekende tag. Gebruik {username}, {displayname}, {channel} of {command}.';return '';
    }
    return context[name as keyof CommandTemplateContext];
  }));
  return {responses:rendered,error};
}

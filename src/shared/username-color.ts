export function usernameColor(name:string):number {
  let hash=2166136261;
  for(const character of name.replace(/^@/,'').toLowerCase())hash=Math.imul(hash^character.codePointAt(0)!,16777619);
  return (hash>>>0)%12;
}

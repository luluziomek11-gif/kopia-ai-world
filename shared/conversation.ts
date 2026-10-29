/** A direct salutation chooses its addressee; merely mentioning a person does not. */
export function addressedResident(text: string): string | undefined {
  const call = text.trim().toLowerCase().replace(/^\s*(?:hej|hey|cześć|czesc|siema|witaj|halo|dzień dobry|dzien dobry)[\s,!:.—-]*/u, '');
  if (/^ultron(?:ie)?(?:[\s,!?:.—-]|$)/u.test(call)) return 'ultron_001';
  if (/^(?:e\.?d\.?i\.?t\.?h\.?|edi)(?:[\s,!?:.—-]|$)/u.test(call)) return 'edith_002';
  return undefined;
}

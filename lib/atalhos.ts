export function alvoEditavel(alvo: EventTarget | null): boolean {
  return alvo instanceof Element && !!alvo.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]');
}

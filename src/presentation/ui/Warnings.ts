/** Warning banner at the top: shows up to four active problems. */
import type { Warning } from '../../domain/analysis';
import { t } from '../../infrastructure/i18n';
import { warningText } from '../describe';

const esc = (s: string): string => s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

export function renderWarnings(el: HTMLElement, warnings: Array<Warning | null>): void {
  const active = warnings.filter((w): w is Warning => !!w);
  el.innerHTML = active.slice(0, 4).map(w => '<div>⚠ ' + esc(w.partId + ': ' + warningText(w)) + '</div>').join('') +
    (active.length > 4 ? '<div>' + esc(t('warn.more', active.length - 4)) + '</div>' : '');
}

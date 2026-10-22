import { useRef, useState, type ClipboardEvent, type Dispatch, type KeyboardEvent, type SetStateAction } from 'react';
import { ROOM_MAX_FIGHTERS } from '../../protocol.ts';
import { PALETTE } from '../../rules/factions.ts';
import { css } from '../hud/context.ts';
import { addTokens, ISSUE_TEXT, type Chip, type Skip } from './fighters.ts';

const SEPARATOR = /[\s,;]/;

function skipNote(skipped: readonly Skip[]): string | null {
  const dupes = skipped.filter((s) => s.why === 'duplicate').map((s) => `@${s.token}`);
  const over = skipped.filter((s) => s.why === 'full').length;
  const parts = [];
  if (dupes.length) parts.push(`${dupes.join(', ')} ${dupes.length === 1 ? 'is' : 'are'} already on the roll`);
  if (over) parts.push(`${over} left out, a battle holds ${ROOM_MAX_FIGHTERS} fighters`);
  return parts.length ? `${parts.join('. ')}.` : null;
}

export function FighterChips({
  chips,
  onChips,
  draft,
  onDraft,
  disabled,
}: {
  chips: Chip[];
  onChips: Dispatch<SetStateAction<Chip[]>>;
  draft: string;
  onDraft(d: string): void;
  disabled: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<string | null>(null);
  const full = chips.length >= ROOM_MAX_FIGHTERS;

  const commit = (text: string) => {
    const { chips: next, skipped } = addTokens(chips, text);
    onChips(next);
    onDraft('');
    setNote(skipNote(skipped));
  };

  const remove = (login: string) => {
    onChips((current) => current.filter((c) => c.login !== login));
    setNote(null);
    input.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'Enter' || e.key === 'Tab') && draft.trim()) {
      e.preventDefault();
      commit(draft);
    } else if (e.key === 'Backspace' && draft === '' && chips.length > 0) {
      e.preventDefault();
      remove(chips[chips.length - 1]!.login);
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    if (!SEPARATOR.test(text.trim())) return;
    e.preventDefault();
    commit(`${draft} ${text}`);
  };

  const onChange = (value: string) => {
    if (SEPARATOR.test(value)) commit(value);
    else onDraft(value);
  };

  return (
    <div className="chips-field">
      <div className="chips" data-disabled={disabled} onClick={(e) => e.target === e.currentTarget && input.current?.focus()}>
        {chips.map((chip, i) => (
          <span
            key={chip.login.toLowerCase()}
            className="chip"
            data-issue={chip.issue !== null}
            style={chip.issue ? undefined : { ['--c' as string]: css(PALETTE[i % PALETTE.length]!) }}
          >
            <span className="chip-mark" aria-hidden />
            <span className="chip-body">
              <span className="chip-login">@{chip.login}</span>
              {chip.issue && <span className="chip-issue">{ISSUE_TEXT[chip.issue]}</span>}
            </span>
            <button type="button" className="chip-remove" onClick={() => remove(chip.login)} aria-label={`Remove @${chip.login}`} disabled={disabled}>
              ×
            </button>
          </span>
        ))}
        <input
          ref={input}
          className="chips-input"
          value={draft}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => draft.trim() && commit(draft)}
          placeholder={full ? 'The roll is full' : chips.length === 0 ? 'Type a GitHub username' : 'Add another'}
          aria-label="GitHub usernames"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          maxLength={60}
          disabled={disabled || full}
        />
      </div>
      {note && (
        <div className="chips-note" role="status">
          {note}
        </div>
      )}
    </div>
  );
}

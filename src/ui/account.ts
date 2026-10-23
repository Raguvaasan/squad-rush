import type { Online } from '../net/online';
import { NAME_RULES, normalizeName, type Leaderboard, type Profile, type RunReward } from '../net/protocol';
import { byId } from './dom';

export type RewardState =
  | { status: 'unranked' }
  | { status: 'saving' }
  | { status: 'saved'; reward: RunReward }
  | { status: 'failed'; message: string };

/** The player closing or re-opening the Google popup isn't an error worth showing. */
const POPUP_DISMISSED = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request']);

/** Everything that talks to the server: the account strip, the name dialog, the leaderboard and run rewards. */
export class AccountUi {
  private readonly nameButton = byId<HTMLButtonElement>('name');
  private readonly coins = byId('coins');
  private readonly google = byId<HTMLButtonElement>('google');
  private readonly status = byId('account-status');
  private readonly reward = byId('reward');
  private readonly board = byId<HTMLDialogElement>('board');
  private readonly boardList = byId('board-list');
  private readonly boardStatus = byId('board-status');
  private readonly nameDialog = byId<HTMLDialogElement>('name-dialog');
  private readonly nameInput = byId<HTMLInputElement>('name-input');
  private readonly nameError = byId('name-error');
  private readonly nameSave = byId<HTMLButtonElement>('name-save');
  private online: Online | null = null;

  constructor(private readonly onProfile: (profile: Profile) => void) {
    this.nameButton.addEventListener('click', () => this.openNameDialog());
    byId('name-cancel').addEventListener('click', () => this.nameDialog.close());
    byId('name-form').addEventListener('submit', (e) => {
      e.preventDefault();
      void this.saveName();
    });
    this.google.addEventListener('click', () => void this.linkGoogle());
    for (const button of document.querySelectorAll('[data-board]')) {
      button.addEventListener('click', () => void this.openBoard());
    }
  }

  attach(online: Online): void {
    this.online = online;
    for (const el of document.querySelectorAll<HTMLElement>('[data-online]')) el.hidden = false;
    this.setProfile(online.profile);
  }

  showReward(state: RewardState): void {
    this.reward.hidden = !this.online;
    this.reward.textContent = rewardText(state);
    this.reward.classList.toggle('error', state.status === 'failed');
  }

  setProfile(profile: Profile): void {
    this.nameButton.textContent = profile.name;
    this.coins.textContent = profile.coins.toLocaleString();
    this.google.hidden = !profile.anonymous;
    this.onProfile(profile);
  }

  private openNameDialog(): void {
    if (!this.online) return;
    this.nameInput.value = this.online.profile.name;
    this.nameError.textContent = '';
    this.nameDialog.showModal();
    this.nameInput.select();
  }

  private async saveName(): Promise<void> {
    const name = normalizeName(this.nameInput.value);
    if (!name) {
      this.nameError.textContent = NAME_RULES;
      return;
    }
    this.nameSave.disabled = true;
    try {
      this.setProfile(await this.online!.rename(name));
      this.nameDialog.close();
    } catch (err) {
      this.nameError.textContent = messageOf(err);
    } finally {
      this.nameSave.disabled = false;
    }
  }

  private async linkGoogle(): Promise<void> {
    this.google.disabled = true;
    this.status.textContent = '';
    try {
      this.setProfile(await this.online!.signInWithGoogle());
    } catch (err) {
      if (!POPUP_DISMISSED.has((err as { code?: string }).code ?? '')) {
        this.status.textContent = `Couldn't sign in: ${messageOf(err)}`;
      }
    } finally {
      this.google.disabled = false;
    }
  }

  private async openBoard(): Promise<void> {
    if (!this.online) return;
    this.boardList.replaceChildren();
    this.boardStatus.textContent = 'Loading…';
    this.board.showModal();
    try {
      this.renderBoard(await this.online.leaderboard());
    } catch (err) {
      this.boardStatus.textContent = `Couldn't load the leaderboard: ${messageOf(err)}`;
    }
  }

  private renderBoard({ top, me }: Leaderboard): void {
    this.boardList.replaceChildren(
      ...top.map((entry) => {
        const row = document.createElement('li');
        row.classList.toggle('me', entry.me);
        row.append(cell(`#${entry.rank}`), cell(entry.name), cell(entry.best.toLocaleString()));
        return row;
      }),
    );
    this.boardStatus.textContent =
      top.length === 0
        ? 'No scores yet. Be the first!'
        : me.rank === null
          ? 'Finish a run to get on the board.'
          : top.some((entry) => entry.me)
            ? ''
            : `You: #${me.rank.toLocaleString()} with ${me.best.toLocaleString()}`;
    this.setProfile(me);
  }
}

function rewardText(state: RewardState): string {
  switch (state.status) {
    case 'unranked':
      return 'Unranked: the server didn’t answer in time.';
    case 'saving':
      return 'Saving score…';
    case 'saved': {
      const { coinsEarned, profile } = state.reward;
      const rank = profile.rank === null ? '' : ` · Rank #${profile.rank.toLocaleString()}`;
      return `+${coinsEarned.toLocaleString()} coins${rank}`;
    }
    case 'failed':
      return `Score not saved: ${state.message}`;
  }
}

function cell(text: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.textContent = text;
  return span;
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

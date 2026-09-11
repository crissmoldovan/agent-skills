import { requireThat } from '../core.ts';

export type FinalReply = 'begin-error' | 'begin-result' | 'cancel-ack';

/** Pure internal model, not a durability implementation or a wire extension. */
export class TerminalDecision {
  private state: 'running' | 'critical' | 'success' | 'failure' = 'running';
  private cancelled = false;
  private quiescent = false;
  private beginFinalized = false;
  private cancelFinalized = false;
  private connected = true;

  get outcome(): 'running' | 'critical' | 'success' | 'failure' { return this.state; }
  disconnect(): void {
    this.connected = false;
    if (this.state === 'running') this.state = 'failure';
  }

  cancel(): 'accepted' | 'queued' | 'terminal' {
    this.cancelled = true;
    if (this.state === 'critical') return 'queued';
    if (this.state === 'running') { this.state = 'failure'; return 'accepted'; }
    return 'terminal';
  }
  establishQuiescence(): void { this.quiescent = true; }
  enterCriticalSection(): boolean {
    if (this.state !== 'running' || !this.quiescent) return false;
    this.state = 'critical';
    return true;
  }
  finishCriticalSection(durable: boolean): void {
    requireThat(this.state === 'critical' && typeof durable === 'boolean');
    this.state = durable ? 'success' : 'failure';
  }
  finalizeReplies(): FinalReply[] {
    if (!this.connected || !this.quiescent || !['success', 'failure'].includes(this.state)) return [];
    const replies: FinalReply[] = [];
    if (!this.beginFinalized) {
      this.beginFinalized = true;
      replies.push(this.state === 'success' ? 'begin-result' : 'begin-error');
    }
    if (this.cancelled && !this.cancelFinalized) {
      this.cancelFinalized = true;
      replies.push('cancel-ack');
    }
    return replies;
  }
}

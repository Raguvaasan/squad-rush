import { BALANCE } from './balance';
import type { Gate } from './types';

function rawResult(squad: number, gate: Gate): number {
  switch (gate.op) {
    case 'add':
      return squad + gate.value;
    case 'mul':
      return squad * gate.value;
    case 'div':
      return Math.ceil(squad / gate.value);
  }
}

export function applyGate(squad: number, gate: Gate): number {
  return Math.max(0, Math.min(BALANCE.maxSquad, Math.round(rawResult(squad, gate))));
}

export const isGoodGate = (gate: Gate): boolean => gate.op === 'mul' || (gate.op === 'add' && gate.value > 0);

export function gateLabel(gate: Gate): string {
  switch (gate.op) {
    case 'add':
      return gate.value > 0 ? `+${gate.value}` : String(gate.value);
    case 'mul':
      return `×${gate.value}`;
    case 'div':
      return `÷${gate.value}`;
  }
}

import type { TitleRarity } from '../data/title-catalog';
import { C, registerStyleSync, type Palette } from './palette';

export function toAccount(p: Palette) {
  return {
    canvas: p.canvas,
    card: p.surfaceRaised,
    cardHi: p.surfaceSoft,
    line: p.line,
    text: p.text,
    muted: p.muted,
    dim: p.dim,
    blue: p.blue,
    indigo: p.scheme === 'light' ? '#4F46E5' : '#6366F1',
    orange: p.orange,
    red: p.red,
    purple: p.scheme === 'light' ? '#7C3AED' : '#A855F7',
    green: p.green,
  };
}

export let A = toAccount(C);

const RARITY_UI_BY_SCHEME: Record<Palette['scheme'], Record<TitleRarity, {
  color: string;
  border: string;
  fill: string;
  tag: string;
  watermark: string;
}>> = {
  dark: {
    UR: { color: '#E9D5FF', border: '#A855F7', fill: 'rgba(168,85,247,0.16)', tag: '#7C3AED', watermark: 'rgba(168,85,247,0.18)' },
    SSR: { color: '#FDBA74', border: '#F97316', fill: 'rgba(249,115,22,0.14)', tag: '#EA580C', watermark: 'rgba(249,115,22,0.18)' },
    SR: { color: '#93C5FD', border: '#3B82F6', fill: 'rgba(59,130,246,0.14)', tag: '#2563EB', watermark: 'rgba(59,130,246,0.16)' },
    R: { color: '#CBD5E1', border: '#64748B', fill: 'rgba(100,116,139,0.16)', tag: '#475569', watermark: 'rgba(148,163,184,0.14)' },
    N: { color: '#94A3B8', border: '#3F4A5A', fill: 'rgba(30,41,59,0.55)', tag: '#334155', watermark: 'rgba(148,163,184,0.10)' },
  },
  light: {
    UR: { color: '#6D28D9', border: '#C4B5FD', fill: '#F3E8FF', tag: '#7C3AED', watermark: 'rgba(124,58,237,0.10)' },
    SSR: { color: '#B45309', border: '#F0C070', fill: '#FFF6E8', tag: '#D97706', watermark: 'rgba(217,119,6,0.10)' },
    SR: { color: '#1D4ED8', border: '#93C5FD', fill: '#E8F1FF', tag: '#2563EB', watermark: 'rgba(37,99,235,0.08)' },
    R: { color: '#334155', border: '#94A3B8', fill: '#EEF1F4', tag: '#475569', watermark: 'rgba(71,85,105,0.08)' },
    N: { color: '#3F4A5A', border: '#C5CCD6', fill: '#F4F6F8', tag: '#4B5565', watermark: 'rgba(75,85,101,0.08)' },
  },
};

export let RARITY_UI = RARITY_UI_BY_SCHEME[C.scheme];

registerStyleSync(() => {
  A = toAccount(C);
  RARITY_UI = RARITY_UI_BY_SCHEME[C.scheme];
});

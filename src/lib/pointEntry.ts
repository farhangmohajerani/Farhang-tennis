/**
 * The point screen's buttons: which strokes it offers for the return and the rally, and how a
 * recorded point maps back onto them (to correct the last point after undo).
 */
import { composePoint, draftOf, netImplied, other, type Point, type PointDraft, type Side } from './match';
import type { PointEnd, ShotType, Wing } from '../types';

/** A stroke button on the point screen: the shot that ended the point. */
export interface StrokeDef {
  key: string;
  /** Fixed forehand / backhand; null when the button does not say (drop shot, lob, overhead…). */
  wing: Wing | null;
  shot: ShotType;
}
export const RETURN_STROKES: StrokeDef[] = [
  { key: 'fh', wing: 'fh', shot: 'drive' },
  { key: 'bh', wing: 'bh', shot: 'drive' },
  { key: 'fh-slice', wing: 'fh', shot: 'slice' },
  { key: 'bh-slice', wing: 'bh', shot: 'slice' },
];
export const RALLY_STROKES: StrokeDef[] = [
  ...RETURN_STROKES,
  { key: 'fh-volley', wing: 'fh', shot: 'volley' },
  { key: 'bh-volley', wing: 'bh', shot: 'volley' },
  { key: 'overhead', wing: null, shot: 'overhead' },
  { key: 'drop', wing: null, shot: 'drop' },
  { key: 'lob', wing: null, shot: 'lob' },
  { key: 'pass', wing: null, shot: 'pass' },
  { key: 'approach', wing: null, shot: 'approach' },
  { key: 'halfVolley', wing: null, shot: 'halfVolley' },
];

/** Which stroke group is open: the return, or a player's rally shots. */
export type Zone = 'return' | Side;
export interface StrokePick {
  zone: Zone;
  key: string;
}
/** The point screen's state for a point being corrected after undo. */
export interface ComposerSeed {
  draft: PointDraft;
  pick: StrokePick | null;
}

export const findStroke = (list: StrokeDef[], p: Pick<Point, 'wing' | 'shot'>) => list.find((s) => (s.wing ? s.wing === p.wing && s.shot === p.shot : s.shot === p.shot));

/** Put a recorded point back on the point screen: same serve, stroke and details. */
export function seedOf(p: Point, oppNet: boolean): ComposerSeed {
  const draft = draftOf(p, oppNet);
  if (p.end === 'returnWinner' || p.end === 'returnError') {
    const s = findStroke(RETURN_STROKES, p);
    return { draft: { ...draft, wing: null, shot: null }, pick: s ? { zone: 'return', key: s.key } : null };
  }
  if (p.end === 'winner' || p.end === 'forcedError' || p.end === 'unforcedError') {
    const s = findStroke(RALLY_STROKES, p);
    const hitter = p.end === 'winner' ? p.win : other(p.win);
    const implied = netImplied(hitter, p.shot);
    // Only what the coach chose by hand stays a choice: the stroke's own net rule is applied again on saving.
    return {
      draft: { ...draft, wing: s && !s.wing ? p.wing : null, shot: null, netP: draft.netP && !implied.p, netO: draft.netO && !implied.o },
      pick: s ? { zone: hitter, key: s.key } : null,
    };
  }
  return { draft: { ...draft, wing: null, shot: null }, pick: null };
}


/** What a result tap saves: the chosen stroke button fills in forehand / backhand and the kind of shot. */
export function screenPoint(d: PointDraft, actor: Side, end: PointEnd, stroke?: StrokeDef): { point: Point; oppNet: boolean } {
  const draft: PointDraft = stroke ? { ...d, wing: stroke.wing ?? d.wing, shot: stroke.shot } : { ...d, wing: null, shot: null };
  return composePoint(draft, actor, end);
}

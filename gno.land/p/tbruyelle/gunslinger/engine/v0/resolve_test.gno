package engine

import (
	"testing"

	"gno.land/p/tbruyelle/gunslinger/cards/v0"
	"gno.land/p/tbruyelle/gunslinger/hex/v0"
)

// resolve plays the two plan strings on st with a stub deck that always
// deals card 37 (DELAY 1), like the BGA reference engine's stub.
func resolve(t *testing.T, st State, p0, p1 string) (State, []Event) {
	t.Helper()
	return resolveWith(t, st, p0, p1, Fixed(37))
}

func resolveWith(t *testing.T, st State, p0, p1 string, d Drawer) (State, []Event) {
	t.Helper()
	return Resolve(hex.A, st, [NumPlayers]Plan{mustPlan(t, p0), mustPlan(t, p1)}, d)
}

func ofKind(evs []Event, player int, kind string) []Event {
	var out []Event
	for _, e := range evs {
		if e.Player == player && e.Kind == kind {
			out = append(out, e)
		}
	}
	return out
}

func neighbor(t *testing.T, id string, d hex.Dir) string {
	t.Helper()
	nb, ok := hex.A.Neighbor(id, d)
	if !ok {
		t.Fatalf("no neighbour of %s toward %s", id, d)
	}
	return nb
}

func TestMultiCostActionExecutesOnce(t *testing.T) {
	st, evs := resolve(t, NewState(), "1f:ahead", "")
	moves := ofKind(evs, 0, EvMove)
	if len(moves) != 1 {
		t.Fatalf("got %d move events: %v", len(moves), evs)
	}
	m := moves[0]
	if m.Seg != 2 || m.From != "A-F3" || m.To != "A-F4" || m.Action != cards.Advance || m.Facing != hex.S || m.Down {
		t.Errorf("move = %+v", m)
	}
	if st.Chars[0].Hex != "A-F4" || st.Chars[0].Delay != 0 {
		t.Errorf("char 0 = %+v", st.Chars[0])
	}
	if len(evs) != 1 {
		t.Errorf("unexpected extra events: %v", evs)
	}
	if st.Chars[1] != NewState().Chars[1] {
		t.Errorf("idle char 1 changed: %+v", st.Chars[1])
	}
}

func TestCarriedDelayPushesActions(t *testing.T) {
	st := NewState()
	st.Chars[0].Delay = 1
	st, evs := resolve(t, st, "1f:ahead,3b:ahead_left", "")
	moves, turns := ofKind(evs, 0, EvMove), ofKind(evs, 0, EvTurn)
	if len(moves) != 1 || moves[0].Seg != 3 {
		t.Errorf("advance with 1 carried delay should execute at seg 3: %v", moves)
	}
	if len(turns) != 1 || turns[0].Seg != 4 || turns[0].Facing != hex.SE {
		t.Errorf("turn ahead_left from S should execute at seg 4 facing SE: %v", turns)
	}
	if st.Chars[0].Facing != hex.SE || st.Chars[0].Hex != "A-F4" {
		t.Errorf("char 0 = %+v", st.Chars[0])
	}
}

func TestSegmentFiveCancels(t *testing.T) {
	st, evs := resolve(t, NewState(), "4b,1f:ahead,3b:ahead_left", "")
	flips := ofKind(evs, 0, EvFlip)
	if len(flips) != 1 || flips[0].Seg != 1 || !flips[0].Down || flips[0].Action != cards.LeapDrop {
		t.Errorf("leap/drop should flip down at seg 1: %v", flips)
	}
	// Two delay cards for the leap: applied from segment 2, so the advance
	// (1 used + 2 cost + 2 delay) lands on segment 5, crawling.
	moves := ofKind(evs, 0, EvMove)
	if len(moves) != 1 || moves[0].Seg != 5 || !moves[0].Down || moves[0].To != "A-F4" {
		t.Errorf("advance should crawl to A-F4 at seg 5: %v", moves)
	}
	delays := ofKind(evs, 0, EvDelay)
	if len(delays) != 3 || delays[0].Reason != ReasonLeap || delays[0].N != 1 || delays[0].Delay != 1 || delays[0].Card != 37 ||
		delays[1].Reason != ReasonLeap || delays[1].N != 1 || delays[1].Delay != 2 || delays[1].Card != 37 ||
		delays[2].Reason != ReasonCrawl || delays[2].N != 2 || delays[2].Delay != 4 || delays[2].Card != 0 {
		t.Errorf("delays = %v", delays)
	}
	cancels := ofKind(evs, 0, EvCancel)
	if len(cancels) != 1 || cancels[0].Action != cards.Turn || cancels[0].Reason != ReasonTime || cancels[0].Seg != EndOfTurn {
		t.Errorf("the turn should be cancelled for lack of time: %v", cancels)
	}
	if st.Chars[0].Delay != 4 || !st.Chars[0].Down || st.Chars[0].Facing != hex.S {
		t.Errorf("char 0 = %+v", st.Chars[0])
	}
}

func TestOccupiedHexPenalty(t *testing.T) {
	st := NewState()
	st.Chars[0] = Character{Hex: "A-F5", Facing: hex.S}
	st.Chars[1] = Character{Hex: "A-F7", Facing: hex.N}
	// Both advance into A-F6 on segment 2: both draw a delay card.
	st, evs := resolve(t, st, "1f:ahead", "1f:ahead")
	for p := 0; p < 2; p++ {
		if st.Chars[p].Hex != "A-F6" {
			t.Errorf("char %d at %s", p, st.Chars[p].Hex)
		}
		d := ofKind(evs, p, EvDelay)
		if len(d) != 1 || d[0].Seg != 2 || d[0].Reason != ReasonOccupied || d[0].N != 1 || d[0].Delay != 1 {
			t.Errorf("char %d delays = %v", p, d)
		}
	}

	// A mover ending in a stationary character's hex: both draw (rule 9.24).
	st = NewState()
	st.Chars[0] = Character{Hex: "A-F5", Facing: hex.S}
	st.Chars[1] = Character{Hex: "A-F6", Facing: hex.N}
	st, evs = resolve(t, st, "1f:ahead", "")
	for p := 0; p < 2; p++ {
		if d := ofKind(evs, p, EvDelay); len(d) != 1 || d[0].Reason != ReasonOccupied {
			t.Errorf("char %d delays = %v", p, d)
		}
		if st.Chars[p].Delay != 1 {
			t.Errorf("char %d delay = %d", p, st.Chars[p].Delay)
		}
	}

	// Moving out of a shared hex carries no penalty.
	st = NewState()
	st.Chars[0] = Character{Hex: "A-F6", Facing: hex.S}
	st.Chars[1] = Character{Hex: "A-F6", Facing: hex.N}
	_, evs = resolve(t, st, "1f:ahead", "")
	if d := ofKind(evs, 0, EvDelay); len(d) != 0 {
		t.Errorf("leaving a shared hex should not cost delay: %v", d)
	}
}

func TestSprintGoesStraightAndDrawsDelay(t *testing.T) {
	start := NewState()
	st, evs := resolve(t, start, "1f:ahead_left,2f:ahead,3f", "")
	moves := ofKind(evs, 0, EvMove)
	if len(moves) != 3 {
		t.Fatalf("moves = %v", moves)
	}
	// Facing S: ahead_left is SE, then ahead and sprint go S.
	h1 := neighbor(t, "A-F3", hex.SE)
	h2 := neighbor(t, h1, hex.S)
	h3 := neighbor(t, h2, hex.S)
	want := []struct {
		seg    int
		action cards.Code
		to     string
	}{{2, cards.Advance, h1}, {3, cards.Run, h2}, {4, cards.Sprint, h3}}
	for i, w := range want {
		if moves[i].Seg != w.seg || moves[i].Action != w.action || moves[i].To != w.to {
			t.Errorf("move %d = %+v, want %+v", i, moves[i], w)
		}
	}
	delays := ofKind(evs, 0, EvDelay)
	if len(delays) != 1 || delays[0].Seg != 4 || delays[0].Reason != ReasonSprint || delays[0].N != 1 || delays[0].Card != 37 || delays[0].Result != "" {
		t.Errorf("delays = %v", delays)
	}
	if st.Chars[0].Hex != h3 || st.Chars[0].Facing != hex.S || st.Chars[0].Delay != 1 {
		t.Errorf("char 0 = %+v", st.Chars[0])
	}
}

func TestCrawlPenalty(t *testing.T) {
	st := NewState()
	st.Chars[0].Down = true
	st, evs := resolve(t, st, "1f:ahead", "")
	d := ofKind(evs, 0, EvDelay)
	if len(d) != 1 || d[0].Reason != ReasonCrawl || d[0].N != 2 || d[0].Seg != 2 {
		t.Errorf("delays = %v", d)
	}
	if st.Chars[0].Hex != "A-F4" || st.Chars[0].Delay != 2 {
		t.Errorf("char 0 = %+v", st.Chars[0])
	}
}

func TestOffBoardMoveIsCancelledButConsumesTime(t *testing.T) {
	st := NewState()
	st.Chars[1] = Character{Hex: "A-F12", Facing: hex.S} // the bottom edge
	st, evs := resolve(t, st, "", "1f:ahead,3b:ahead_left")
	if m := ofKind(evs, 1, EvMove); len(m) != 0 {
		t.Errorf("unexpected moves: %v", m)
	}
	c := ofKind(evs, 1, EvCancel)
	if len(c) != 1 || c[0].Seg != 2 || c[0].Action != cards.Advance || c[0].Reason != ReasonOffBoard {
		t.Errorf("cancels = %v", c)
	}
	turns := ofKind(evs, 1, EvTurn)
	if len(turns) != 1 || turns[0].Seg != 3 || turns[0].Facing != hex.SE {
		t.Errorf("turns = %v", turns)
	}
	if st.Chars[1].Hex != "A-F12" || st.Chars[1].Delay != 0 {
		t.Errorf("char 1 = %+v", st.Chars[1])
	}
}

func TestGetUpDownAndSpin(t *testing.T) {
	st, evs := resolve(t, NewState(), "5b,2b:back_right", "")
	flips, turns := ofKind(evs, 0, EvFlip), ofKind(evs, 0, EvTurn)
	if len(flips) != 1 || flips[0].Seg != 3 || !flips[0].Down {
		t.Errorf("flips = %v", flips)
	}
	// Facing S, back_right is NW.
	if len(turns) != 1 || turns[0].Seg != 5 || turns[0].Facing != hex.NW || turns[0].Action != cards.SpinAround {
		t.Errorf("turns = %v", turns)
	}
	if len(ofKind(evs, 0, EvDelay)) != 0 {
		t.Errorf("no delay expected: %v", evs)
	}
	if !st.Chars[0].Down || st.Chars[0].Facing != hex.NW {
		t.Errorf("char 0 = %+v", st.Chars[0])
	}
}

func TestOutPlayerIsSkipped(t *testing.T) {
	st := NewState()
	st.Chars[1].Status = Out
	st, evs := resolve(t, st, "1f:ahead", "1f:ahead,3b:ahead")
	for _, e := range evs {
		if e.Player == 1 {
			t.Errorf("event for the out player: %+v", e)
		}
	}
	if st.Chars[1].Hex != "A-F9" || st.Chars[0].Hex != "A-F4" {
		t.Errorf("state = %+v", st)
	}
	if AliveCount(st) != 1 {
		t.Errorf("AliveCount = %d", AliveCount(st))
	}
}

func TestResolveDoesNotMutateInput(t *testing.T) {
	st := NewState()
	resolve(t, st, "1f:ahead", "1f:ahead")
	if st.Chars != NewState().Chars || len(st.Ground) != 0 {
		t.Errorf("input state mutated: %+v", st)
	}
}

func TestEndTurnAndBudget(t *testing.T) {
	// Rule 6.3 example: 5 -> 2 -> 1 -> 0.
	for _, tt := range [][2]int{{5, 2}, {3, 1}, {2, 1}, {1, 0}, {0, 0}, {4, 2}} {
		st := NewState()
		st.Chars[0].Delay = tt[0]
		st.Chars[0].PlayedFoot, st.Chars[0].PlayedRun = true, true
		st, _ = EndTurn(st)
		if st.Chars[0].Delay != tt[1] {
			t.Errorf("EndTurn delay %d -> %d, want %d", tt[0], st.Chars[0].Delay, tt[1])
		}
		if st.Chars[0].PlayedFoot || st.Chars[0].PlayedRun {
			t.Error("flags not cleared")
		}
		if !st.Chars[0].RanLastTurn {
			t.Error("RanLastTurn should carry PlayedRun over")
		}
	}
	if st, _ := EndTurn(NewState()); st.Chars[0].RanLastTurn {
		t.Error("RanLastTurn set without a run")
	}
	ran := NewState()
	ran.Chars[0].PlayedRun = true
	ran, _ = EndTurn(ran)
	if ran, _ = EndTurn(ran); ran.Chars[0].RanLastTurn {
		t.Error("RanLastTurn should last one turn only")
	}
	for _, tt := range [][2]int{{0, 5}, {2, 3}, {5, 0}, {7, 0}} {
		st := NewState()
		st.Chars[1].Delay = tt[0]
		if got := st.Budget(1); got != tt[1] {
			t.Errorf("Budget with delay %d = %d, want %d", tt[0], got, tt[1])
		}
	}
	if s := NewState(); s.Chars[0].Hex != "A-F3" || s.Chars[0].Facing != hex.S || s.Chars[1].Hex != "A-F9" || s.Chars[1].Facing != hex.N || AliveCount(s) != 2 {
		t.Errorf("NewState = %+v", s)
	}
	if Alive.String() != "alive" || Out.String() != "out" {
		t.Error("Status.String")
	}
}

func TestDrawAndCock(t *testing.T) {
	st, evs := resolve(t, NewState(), "9f:1:0", "")
	draws := ofKind(evs, 0, EvDraw)
	if len(draws) != 1 || draws[0].Seg != 3 || draws[0].Gun != Colt45 || draws[0].GunID != 1 || draws[0].From != "holstered" || draws[0].To != "gun_hand" {
		t.Fatalf("draws = %v", draws)
	}
	g := st.Chars[0].Guns[0]
	if g.Location != GunHand || !g.Cocked || g.Shells != 6 {
		t.Errorf("gun = %+v", g)
	}
	if st.Chars[1].Guns[0].Location != Holstered {
		t.Error("the other character's gun moved")
	}
	// With a carried delay of 3 the draw (cost 3) is out of time.
	st = NewState()
	st.Chars[0].Delay = 3
	st, evs = resolve(t, st, "9f:1:0", "")
	if c := ofKind(evs, 0, EvCancel); len(c) != 1 || c[0].Reason != ReasonTime || st.Chars[0].Guns[0].Location != Holstered {
		t.Errorf("cancels = %v, gun = %+v", c, st.Chars[0].Guns[0])
	}
	// A gun that is no longer holstered when the action executes cancels it.
	st = NewState()
	st.Chars[0].Guns[0].Location = GunHand
	_, evs = resolve(t, st, "9f:1:0", "")
	if c := ofKind(evs, 0, EvCancel); len(c) != 1 || c[0].Reason != ReasonNoGun {
		t.Errorf("cancels = %v", c)
	}
}

func TestDelayCardPenalties(t *testing.T) {
	// LOSE AIM (card 88) and a 0 (card 1) on the leap: no delay gained.
	st := NewState()
	seq := Sequence{88, 1}
	st, evs := resolveWith(t, st, "4b", "", &seq)
	d := ofKind(evs, 0, EvDelay)
	if len(d) != 2 || d[0].Card != 88 || d[0].Result != "lose_aim" || d[0].N != 0 || d[1].Card != 1 || d[1].N != 0 || d[1].Result != "" {
		t.Errorf("delays = %v", d)
	}
	if st.Chars[0].Delay != 0 || !st.Chars[0].Down {
		t.Errorf("char 0 = %+v", st.Chars[0])
	}

	// A MALFUNCTION card (104, DELAY 1) is an ordinary delay card: its
	// MALFUNCTION block only matters when shooting.
	st = NewState()
	st.Chars[0].RanLastTurn = true
	seq = Sequence{104}
	st, evs = resolveWith(t, st, "1f:ahead,2f:ahead,3f", "", &seq)
	d = ofKind(evs, 0, EvDelay)
	if len(d) != 1 || d[0].Card != 104 || d[0].Result != "" || d[0].N != 1 || d[0].Reason != ReasonSprint || d[0].Delay != 1 {
		t.Errorf("delays = %v", d)
	}
	if st.Chars[0].Delay != 1 {
		t.Errorf("char 0 delay = %d", st.Chars[0].Delay)
	}

	// WILD SHOT (card 100) fires the cocked gun: uncocked, one shell less.
	st = NewState()
	st.Chars[0].RanLastTurn = true
	st.Chars[0].Guns[0].Location = GunHand
	st.Chars[0].Guns[0].Cocked = true
	seq = Sequence{100}
	st, evs = resolveWith(t, st, "1f:ahead,2f:ahead,3f", "", &seq)
	d = ofKind(evs, 0, EvDelay)
	if len(d) != 1 || d[0].Card != 100 || d[0].Result != "wild_shot" || d[0].N != 0 {
		t.Errorf("delays = %v", d)
	}
	ws := ofKind(evs, 0, EvWildShot)
	if len(ws) != 1 || ws[0].Seg != 4 || ws[0].Gun != Colt45 || ws[0].GunID != 1 || ws[0].From != "gun_hand" {
		t.Errorf("wild shots = %v", ws)
	}
	if g := st.Chars[0].Guns[0]; g.Cocked || g.Shells != 5 || st.Chars[0].Delay != 0 {
		t.Errorf("gun = %+v, delay %d", g, st.Chars[0].Delay)
	}
	// Without a cocked gun a WILD SHOT is harmless.
	st = NewState()
	st.Chars[0].RanLastTurn = true
	seq = Sequence{100}
	st, evs = resolveWith(t, st, "1f:ahead,2f:ahead,3f", "", &seq)
	if ws := ofKind(evs, 0, EvWildShot); len(ws) != 0 || st.Chars[0].Guns[0].Shells != 6 {
		t.Errorf("wild shots = %v, gun = %+v", ws, st.Chars[0].Guns[0])
	}
}

func TestDropPenalty(t *testing.T) {
	// DROP on the DELAY line (card 107): an upright character turns DOWN and
	// draws three more delay cards (rule 14.11).
	st := NewState()
	st.Chars[0].RanLastTurn = true
	seq := Sequence{107, 37} // then card 37 (DELAY 1) forever
	st, evs := resolveWith(t, st, "1f:ahead,2f:ahead,3f", "", &seq)
	d := ofKind(evs, 0, EvDelay)
	if len(d) != 4 || d[0].Result != "drop" || d[0].N != 0 || d[0].Reason != ReasonSprint || d[0].Card != 107 ||
		d[1].Reason != ReasonDrop || d[1].N != 1 || d[1].Card != 37 || d[2].Reason != ReasonDrop || d[3].Reason != ReasonDrop || d[3].Delay != 3 {
		t.Errorf("delays = %v", d)
	}
	flips := ofKind(evs, 0, EvFlip)
	if len(flips) != 1 || !flips[0].Down || flips[0].Action != "" || flips[0].Seg != 4 {
		t.Errorf("flips = %v", flips)
	}
	if !st.Chars[0].Down || st.Chars[0].Delay != 3 {
		t.Errorf("char 0 = %+v", st.Chars[0])
	}

	// Already DOWN: a DROP has no effect and draws nothing more.
	c := Character{Hex: "A-F3", Down: true}
	evs = nil
	seq = Sequence{108}
	if gained := drawDelay(0, &c, 2, ReasonOccupied, &seq, &evs); gained != 0 || len(evs) != 1 || evs[0].Result != "drop" || evs[0].Card != 108 || !c.Down {
		t.Errorf("gained %d, events %v, char %+v", gained, evs, c)
	}
}

// armed returns a state where seat p holds its cocked Colt in the gun hand.
func armed(p int) State {
	st := NewState()
	st.Chars[p].Guns[0].Location = GunHand
	st.Chars[p].Guns[0].Cocked = true
	return st
}

func TestCockAimShootOptions(t *testing.T) {
	// No gun in hand: cock, aim and shoot are cancelled (11.3); nothing passes.
	st := NewState()
	_, evs := resolve(t, st, "5f:cock,7f", "")
	c := ofKind(evs, 0, EvCancel)
	if len(c) != 1 || c[0].Action != cards.CockAimShoot || c[0].Reason != ReasonNoGun || c[0].Seg != 2 {
		t.Errorf("cancels = %v", c)
	}
	if n := ofKind(evs, 0, EvNothing); len(n) != 1 || n[0].Seg != 3 {
		t.Errorf("nothing = %v", n)
	}
	// Draw & Cock then uncock, cock again.
	st = NewState()
	st, evs = resolve(t, st, "9f:1:0,5f:uncock", "")
	if u := ofKind(evs, 0, EvUncock); len(u) != 1 || u[0].Seg != 5 || u[0].GunID != 1 || st.Chars[0].Guns[0].Cocked {
		t.Errorf("uncock = %v, gun %+v", u, st.Chars[0].Guns[0])
	}
	st, evs = resolve(t, st, "5f:cock", "")
	if k := ofKind(evs, 0, EvCock); len(k) != 1 || !st.Chars[0].Guns[0].Cocked {
		t.Errorf("cock = %v, gun %+v", k, st.Chars[0].Guns[0])
	}
	// Aiming at the Kid: 2 points per action, capped at 8, kept across
	// Cock/Aim/Shoot reveals; the markers sit on the Kid (Target 1, AimHex "").
	st = armed(0)
	st, evs = resolve(t, st, "5f:aim:@1,6f:aim:@1", "")
	a := ofKind(evs, 0, EvAim)
	if len(a) != 2 || a[0].Seg != 2 || a[0].N != 2 || a[1].Seg != 4 || a[1].N != 4 || a[0].Target != 1 || a[0].To != "A-F9" || st.Chars[0].Aim != 4 || st.Chars[0].AimHex != "" {
		t.Errorf("aims = %v, aim %d on %q", a, st.Chars[0].Aim, st.Chars[0].AimHex)
	}
	if la := ofKind(evs, 0, EvLoseAim); len(la) != 0 {
		t.Errorf("aim lost: %v", la)
	}
	st.Chars[0].Aim = 7
	st, _ = resolve(t, st, "5f:aim:@1", "")
	if st.Chars[0].Aim != MaxAim {
		t.Errorf("aim = %d, want capped at %d", st.Chars[0].Aim, MaxAim)
	}
	// Aiming at an empty hex: the markers stay on the hex (Target -1).
	st = armed(0)
	st, evs = resolve(t, st, "5f:aim:A-F6", "")
	if a := ofKind(evs, 0, EvAim); len(a) != 1 || a[0].Target != -1 || a[0].To != "A-F6" || st.Chars[0].AimHex != "A-F6" || st.Chars[0].Aim != 2 {
		t.Errorf("aims = %v, char %+v", a, st.Chars[0])
	}
	// Aiming at a hex or a character in the blind zone, off the board, or at oneself, is cancelled.
	st = armed(0)
	st.Chars[0].Facing = hex.N // F9 is south
	_, evs = resolve(t, st, "5f:aim:A-F9,6f:aim:A-Z9", "")
	if c := ofKind(evs, 0, EvCancel); len(c) != 2 || c[0].Reason != ReasonOutOfZone || c[1].Reason != ReasonNoHex {
		t.Errorf("cancels = %v", c)
	}
	_, evs = resolve(t, st, "5f:aim:@1,6f:aim:@0", "")
	if c := ofKind(evs, 0, EvCancel); len(c) != 2 || c[0].Reason != ReasonOutOfZone || c[1].Reason != ReasonNoTarget {
		t.Errorf("cancels = %v", c)
	}
}

func TestAimTransfer(t *testing.T) {
	// Markers on F8, next to the Kid at F9: a shot keeps the aim and moves
	// the markers onto the Kid (12.5): aim time 1 + 2 = 3.
	st := armed(0)
	st.Chars[0].Aim, st.Chars[0].AimHex = 2, "A-F8"
	seq := Sequence{1}
	st, evs := resolveWith(t, st, "7f:shoot", "", &seq)
	if sh := ofKind(evs, 0, EvShot); len(sh) != 1 || sh[0].N != 3 {
		t.Errorf("shot = %v", sh)
	}
	if la := ofKind(evs, 0, EvLoseAim); len(la) != 1 || la[0].Reason != ReasonShot {
		t.Errorf("lose aim = %v", la)
	}
	// Markers on the Kid's own hex: the shot counts them just as an aim at the Kid.
	st = armed(0)
	st.Chars[0].Aim, st.Chars[0].AimHex = 4, "A-F9"
	seq = Sequence{1}
	st, evs = resolveWith(t, st, "7f:shoot", "", &seq)
	if sh := ofKind(evs, 0, EvShot); len(sh) != 1 || sh[0].N != 5 || st.Chars[0].AimHex != "" {
		t.Errorf("shot = %v, marshal %+v", sh, st.Chars[0])
	}
	// Markers on F6, three hexes from the Kid: the aim is lost when the shot is revealed.
	st = armed(0)
	st.Chars[0].Aim, st.Chars[0].AimHex = 2, "A-F6"
	seq = Sequence{1}
	st, evs = resolveWith(t, st, "7f:shoot", "", &seq)
	la := ofKind(evs, 0, EvLoseAim)
	if len(la) != 1 || la[0].Reason != ReasonTransfer || la[0].Seg != 0 {
		t.Errorf("lose aim = %v", la)
	}
	if sh := ofKind(evs, 0, EvShot); len(sh) != 1 || sh[0].N != 1 {
		t.Errorf("shot = %v", sh)
	}
	// Aiming at a hex next to the markers keeps the points; farther loses them.
	st = armed(0)
	st.Chars[0].Aim, st.Chars[0].AimHex = 2, "A-F6"
	st, evs = resolve(t, st, "5f:aim:A-F7", "")
	if st.Chars[0].Aim != 4 || st.Chars[0].AimHex != "A-F7" || len(ofKind(evs, 0, EvLoseAim)) != 0 {
		t.Errorf("char = %+v, %v", st.Chars[0], evs)
	}
	st = armed(0)
	st.Chars[0].Aim, st.Chars[0].AimHex = 2, "A-F6"
	st, evs = resolve(t, st, "5f:aim:@1", "") // the Kid at F9, three hexes from the markers
	if st.Chars[0].Aim != 2 || st.Chars[0].AimHex != "" || len(ofKind(evs, 0, EvLoseAim)) != 1 {
		t.Errorf("char = %+v, %v", st.Chars[0], evs)
	}
	// Markers on a hex that leaves the aim zone are lost at the end of the
	// segment: G4 is SE of F3, on the edge of the zone when facing S, out of
	// it once the marshal turns to face SW (a Turn keeps the aim on reveal).
	st = armed(0)
	st.Chars[0].Aim, st.Chars[0].AimHex = 2, "A-G4"
	st, evs = resolve(t, st, "3b:ahead_right", "")
	if la := ofKind(evs, 0, EvLoseAim); st.Chars[0].Aim != 0 || len(la) != 1 || la[0].Reason != ReasonOutOfZone || la[0].Seg != 1 {
		t.Errorf("char = %+v, %v", st.Chars[0], evs)
	}
}

func TestAimIsLost(t *testing.T) {
	// Revealing a foot action loses the aim (12.44), at turn start...
	st := armed(0)
	st.Chars[0].Aim = 4
	st, evs := resolve(t, st, "1f:ahead", "")
	if la := ofKind(evs, 0, EvLoseAim); len(la) != 1 || la[0].Seg != 0 || la[0].Reason != ReasonReveal || st.Chars[0].Aim != 0 {
		t.Errorf("lose aim = %v, aim %d", la, st.Chars[0].Aim)
	}
	// ...or when the next action is revealed; a Turn keeps it.
	st = armed(0)
	st.Chars[0].Aim = 4
	st, evs = resolve(t, st, "3b:ahead,4b", "")
	la := ofKind(evs, 0, EvLoseAim)
	if len(la) != 1 || la[0].Seg != 1 || la[0].Reason != ReasonReveal {
		t.Errorf("lose aim = %v", la)
	}
	// Cocking loses it too.
	st = armed(0)
	st.Chars[0].Aim = 4
	st, evs = resolve(t, st, "5f:cock", "")
	if la := ofKind(evs, 0, EvLoseAim); len(la) != 1 || la[0].Seg != 0 || st.Chars[0].Aim != 0 {
		t.Errorf("lose aim = %v", la)
	}
	// The target moving out of the aim zone at the end of a segment (12.41).
	st = armed(0)
	st.Chars[0].Aim = 4
	st.Chars[0].Hex, st.Chars[0].Facing = "A-F5", hex.S
	st.Chars[1].Hex, st.Chars[1].Facing = "A-G6", hex.N // SE of F5, on the edge of the zone
	st, evs = resolve(t, st, "", "1f:ahead")             // the Kid steps to G5, NE of F5
	if la := ofKind(evs, 0, EvLoseAim); len(la) != 1 || la[0].Seg != 2 || la[0].Reason != ReasonOutOfZone || st.Chars[0].Aim != 0 {
		t.Errorf("lose aim = %v, kid at %s", la, st.Chars[1].Hex)
	}
}

func TestShot(t *testing.T) {
	// Marshal (F3, facing S) shoots the Kid (F9, 6 hexes) with 2 AIM points
	// through a Shoot: aim time 1 + 2 = 3. Card 1: range 6-12+ needs aim 9+
	// so it misses.
	st := armed(0)
	st.Chars[0].Aim = 2
	seq := Sequence{1, 37}
	st, evs := resolveWith(t, st, "7f:shoot", "", &seq)
	sh := ofKind(evs, 0, EvShot)
	if len(sh) != 1 || sh[0].Seg != 1 || sh[0].Card != 1 || sh[0].Target != 1 || sh[0].Range != 6 || sh[0].N != 3 || sh[0].Hit != string(Miss) || sh[0].Reason != "" {
		t.Errorf("shot = %v", sh)
	}
	g := st.Chars[0].Guns[0]
	if g.Cocked || g.Shells != 5 || st.Chars[0].Aim != 0 {
		t.Errorf("after the shot: gun %+v, aim %d", g, st.Chars[0].Aim)
	}
	if la := ofKind(evs, 0, EvLoseAim); len(la) != 1 || la[0].Reason != ReasonShot {
		t.Errorf("lose aim = %v", la)
	}
	if w := ofKind(evs, 1, EvWound); len(w) != 0 {
		t.Errorf("unexpected wounds: %v", w)
	}

	// Point blank with 6 AIM points: aim time 8 through Cock/Aim/Shoot (2 + 6).
	// Card 1 at range 1: SIDE. The Colt's SIDE hit (line B): STUN 2, STAGGER.
	st = armed(0)
	st.Chars[0].Aim = 6
	st.Chars[0].Hex, st.Chars[1].Hex = "A-F5", "A-F6"
	seq = Sequence{1, 19, 19, 61, 65, 37} // FIRE, 2 wound cards (WOUND 1 each), 2 direction cards (Same, Same), 3 drop cards (DELAY 1)
	st, evs = resolveWith(t, st, "5f:shoot", "", &seq)
	sh = ofKind(evs, 0, EvShot)
	if len(sh) != 1 || sh[0].Seg != 2 || sh[0].Range != 1 || sh[0].N != 8 || sh[0].Hit != string(SideHit) {
		t.Errorf("shot = %v", sh)
	}
	w := ofKind(evs, 1, EvWound)
	if len(w) != 2 || w[0].Result != string(Stun) || w[0].N != 2 || w[1].Result != string(Stagger) || w[0].Seg != 2 {
		t.Errorf("wounds = %v", w)
	}
	// Two wound cards: WOUND 1 each, endurance 20 -> 18; then STAGGER: Same,
	// Same (no move, no turn), DROP: down, three delay cards of 1.
	d := ofKind(evs, 1, EvDelay)
	if len(d) != 5 || d[0].Reason != ReasonStun || d[0].Card != 19 || d[0].N != 1 || d[0].Endurance != 1 || d[0].Delay != 1 ||
		d[1].Delay != 2 || d[2].Reason != ReasonDrop || d[2].Card != 37 || d[2].Delay != 3 || d[4].Delay != 5 {
		t.Errorf("delays = %v", d)
	}
	dir := ofKind(evs, 1, EvDirection)
	if len(dir) != 2 || dir[0].Card != 61 || dir[0].To != string(hex.Same) || dir[1].Card != 65 {
		t.Errorf("directions = %v", dir)
	}
	kid := st.Chars[1]
	if kid.Endurance != 18 || !kid.Down || !kid.Dropped || kid.Delay != 5 || kid.Hex != "A-F6" || kid.Facing != hex.N || kid.Status != Alive {
		t.Errorf("kid = %+v", kid)
	}
	if m := ofKind(evs, 1, EvMove); len(m) != 0 {
		t.Errorf("stagger moved: %v", m)
	}
}

func TestShotKillsAndStaggerMoves(t *testing.T) {
	// A bullseye is a VITAL hit: KILL. Card 6 at range 1 with aim 8+: BE.
	st := armed(0)
	st.Chars[0].Aim = 8
	st.Chars[0].Hex, st.Chars[1].Hex = "A-F5", "A-F6"
	seq := Sequence{6}
	st, evs := resolveWith(t, st, "5f:shoot", "1f:ahead,2f:ahead", &seq)
	sh := ofKind(evs, 0, EvShot)
	if len(sh) != 1 || sh[0].Hit != string(VitalHit) {
		t.Errorf("shot = %v", sh)
	}
	if w := ofKind(evs, 1, EvWound); len(w) != 1 || w[0].Result != string(Kill) {
		t.Errorf("wounds = %v", w)
	}
	kid := st.Chars[1]
	if kid.Status != Killed || !kid.Down || kid.Delay != 0 || AliveCount(st) != 1 {
		t.Errorf("kid = %+v", kid)
	}
	// The Kid's advance executed in the same segment (shots do not interfere,
	// 7.52) but the run never happens; no cancel event for the dead.
	if m := ofKind(evs, 1, EvMove); len(m) != 1 || m[0].Seg != 2 {
		t.Errorf("moves = %v", m)
	}
	if c := ofKind(evs, 1, EvCancel); len(c) != 0 {
		t.Errorf("cancels = %v", c)
	}

	// STAGGER with real directions: BODY hit (card 20 at range 1, aim 6-8).
	// STUN 4 then STAGGER: first card 55 (Ahead Left), second 61 (Same),
	// then DROP. The Kid faces N at F6; ahead left of N is NW: E6.
	st = armed(0)
	st.Chars[0].Aim = 5 // 2 + 5 = 7
	st.Chars[0].Hex, st.Chars[1].Hex = "A-F5", "A-F6"
	seq = Sequence{20, 19, 19, 19, 19, 55, 61, 1} // FIRE, 4 wound cards (WOUND 1), Ahead Left, Same, DELAY 0 drop cards
	st, evs = resolveWith(t, st, "5f:shoot", "", &seq)
	if sh := ofKind(evs, 0, EvShot); len(sh) != 1 || sh[0].Hit != string(BodyHit) {
		t.Errorf("shot = %v", sh)
	}
	w := ofKind(evs, 1, EvWound)
	if len(w) != 3 || w[0].Result != string(Stun) || w[1].Result != string(Stagger) || w[2].Result != string(Serious) || w[2].N != 2 {
		t.Errorf("wounds = %v", w)
	}
	m := ofKind(evs, 1, EvMove)
	if len(m) != 1 || m[0].Reason != ReasonStagger || m[0].From != "A-F6" || m[0].To != "A-E6" {
		t.Errorf("stagger move = %v", m)
	}
	kid = st.Chars[1]
	if kid.Hex != "A-E6" || kid.Facing != hex.N || !kid.Down || kid.Serious != 2 || kid.Endurance != 20-4 {
		t.Errorf("kid = %+v", kid)
	}
}

func TestShotStatusAndOutOfZone(t *testing.T) {
	// "Move" status: the Kid plays a foot action. Card 2 lists Move: a SIDE
	// hit becomes a miss, a BE becomes SIDE. Range 1, aim 8: BE -> SIDE.
	st := armed(0)
	st.Chars[0].Aim = 6
	st.Chars[0].Hex, st.Chars[1].Hex = "A-F5", "A-F6"
	st.Chars[1].PlayedFoot = true
	seq := Sequence{2, 1, 1, 61, 61, 1}
	_, evs := resolveWith(t, st, "5f:shoot", "3b:ahead", &seq)
	if sh := ofKind(evs, 0, EvShot); len(sh) != 1 || sh[0].Hit != string(SideHit) {
		t.Errorf("shot = %v", sh)
	}
	// Down status on top: card 5 lists Down; a SIDE hit on a DOWN target misses.
	st = armed(0)
	st.Chars[0].Aim = 2 // 2 + 2 = 4: SIDE at range 0-5
	st.Chars[0].Hex, st.Chars[1].Hex = "A-F5", "A-F6"
	st.Chars[1].Down = true
	seq = Sequence{5}
	_, evs = resolveWith(t, st, "5f:shoot", "", &seq)
	if sh := ofKind(evs, 0, EvShot); len(sh) != 1 || sh[0].Hit != string(Miss) {
		t.Errorf("shot = %v", sh)
	}
	// Out of the aim zone: the shot fires (card drawn, shell spent) but misses.
	st = armed(0)
	st.Chars[0].Facing = hex.N
	seq = Sequence{6}
	st, evs = resolveWith(t, st, "7f:shoot", "", &seq)
	if sh := ofKind(evs, 0, EvShot); len(sh) != 1 || sh[0].Reason != ReasonOutOfZone || sh[0].Hit != string(Miss) || st.Chars[0].Guns[0].Shells != 5 {
		t.Errorf("shot = %v", sh)
	}
	// Not cocked, empty: cancelled.
	st = armed(0)
	st.Chars[0].Guns[0].Cocked = false
	_, evs = resolve(t, st, "7f:shoot", "")
	if c := ofKind(evs, 0, EvCancel); len(c) != 1 || c[0].Reason != ReasonNotCocked {
		t.Errorf("cancels = %v", c)
	}
	st = armed(0)
	st.Chars[0].Guns[0].Shells = 0
	_, evs = resolve(t, st, "7f:shoot", "")
	if c := ofKind(evs, 0, EvCancel); len(c) != 1 || c[0].Reason != ReasonEmpty {
		t.Errorf("cancels = %v", c)
	}
}

func TestMalfunctions(t *testing.T) {
	// Card 101: no effect with handloaded shells, replaced by card 1 (miss at range 6).
	st := armed(0)
	seq := Sequence{101, 1}
	st, evs := resolveWith(t, st, "7f:shoot", "", &seq)
	m := ofKind(evs, 0, EvMalfunction)
	if len(m) != 1 || m[0].Card != 101 || m[0].Result != MalfNoEffect {
		t.Errorf("malfunctions = %v", m)
	}
	if sh := ofKind(evs, 0, EvShot); len(sh) != 1 || sh[0].Card != 1 {
		t.Errorf("shot = %v", sh)
	}
	// Card 104: misfire; the second draw is a FIRE: no penalty, shell spent.
	st = armed(0)
	seq = Sequence{104, 1}
	st, evs = resolveWith(t, st, "7f:shoot", "", &seq)
	m = ofKind(evs, 0, EvMalfunction)
	if len(m) != 2 || m[0].Result != MalfMisfire || m[1].Card != 1 || m[1].Result != MalfNoPenalty {
		t.Errorf("malfunctions = %v", m)
	}
	if sh := ofKind(evs, 0, EvShot); len(sh) != 1 || sh[0].Reason != ReasonMisfire || sh[0].Hit != string(Miss) || st.Chars[0].Guns[0].Shells != 5 || st.Chars[0].Guns[0].Cocked {
		t.Errorf("shot = %v, gun %+v", sh, st.Chars[0].Guns[0])
	}
	// Misfire then another MALFUNCTION: the gun jams (104) or explodes (107).
	st = armed(0)
	seq = Sequence{105, 104}
	st, evs = resolveWith(t, st, "7f:shoot", "", &seq)
	if m = ofKind(evs, 0, EvMalfunction); len(m) != 2 || m[1].Result != GunJams || !st.Chars[0].Guns[0].Jammed || st.Chars[0].Guns[0].Shells != 0 {
		t.Errorf("malfunctions = %v, gun %+v", m, st.Chars[0].Guns[0])
	}
	st = armed(0)
	seq = Sequence{107, 108}
	st, evs = resolveWith(t, st, "7f:shoot", "", &seq)
	if m = ofKind(evs, 0, EvMalfunction); len(m) != 2 || m[1].Result != GunExplodes || !st.Chars[0].Guns[0].Exploded {
		t.Errorf("malfunctions = %v, gun %+v", m, st.Chars[0].Guns[0])
	}
	st.Chars[0].Guns[0].Cocked = true
	_, evs = resolve(t, st, "7f:shoot", "")
	if c := ofKind(evs, 0, EvCancel); len(c) != 1 || c[0].Reason != ReasonBroken {
		t.Errorf("cancels = %v", c)
	}
}

func TestGunHitDropsTheGun(t *testing.T) {
	// GUN hit (card 81 at range 1, aim 4-7): STUN 4, GUN HAND, SERIOUS 1, GUN ARM 4.
	// The Kid holds a cocked Colt: it goes off and falls in the hex.
	st := armed(0)
	st.Chars[0].Aim = 3 // 2 + 3 = 5
	st.Chars[0].Hex, st.Chars[1].Hex = "A-F5", "A-F6"
	st.Chars[1].Guns[0].Location = GunHand
	st.Chars[1].Guns[0].Cocked = true
	st.Chars[1].Aim = 2
	seq := Sequence{81, 19, 19, 19, 19} // FIRE, 4 wound cards (WOUND 1)
	st, evs := resolveWith(t, st, "5f:shoot", "", &seq)
	if sh := ofKind(evs, 0, EvShot); len(sh) != 1 || sh[0].Hit != string(GunHit) {
		t.Errorf("shot = %v", sh)
	}
	if ws := ofKind(evs, 1, EvWildShot); len(ws) != 1 || ws[0].GunID != 1 {
		t.Errorf("wild shots = %v", ws)
	}
	dg := ofKind(evs, 1, EvDropGun)
	if len(dg) != 1 || dg[0].From != "gun_hand" || dg[0].To != "A-F6" || dg[0].GunID != 1 {
		t.Errorf("drop gun = %v", dg)
	}
	kid := st.Chars[1]
	if kid.Guns.Count() != 0 || kid.Serious != 1 || kid.GunArm != 4 || kid.Aim != 0 || kid.Endurance != 16 {
		t.Errorf("kid = %+v", kid)
	}
	if len(st.Ground) != 1 || st.Ground[0].Hex != "A-F6" || st.Ground[0].Gun.ID != 1 || st.Ground[0].Gun.Shells != 5 || st.Ground[0].Gun.Cocked {
		t.Errorf("ground = %+v", st.Ground)
	}
	// A GUN ARM wound lowers the aim time: with the gun back in hand, 2 + 0 - 4 < 0: off the chart, miss.
	st.Chars[1].Guns = startingGuns()
	st.Chars[1].Guns[0].Location, st.Chars[1].Guns[0].Cocked = GunHand, true
	st.Chars[1].Delay = 0
	seq = Sequence{6}
	_, evs = resolveWith(t, st, "", "5f:shoot", &seq)
	if sh := ofKind(evs, 1, EvShot); len(sh) != 1 || sh[0].N != -2 || sh[0].Hit != string(Miss) {
		t.Errorf("shot = %v", sh)
	}
}

func TestSeriousFatigueLegAndPassOut(t *testing.T) {
	// SERIOUS 2: two fatigue cards at turn start (DELAY 1 each): delay 2 and
	// endurance 18 before segment 1, pushing an advance to segment 4.
	st := NewState()
	st.Chars[0].Serious = 2
	st, evs := resolve(t, st, "1f:ahead", "")
	d := ofKind(evs, 0, EvDelay)
	if len(d) != 2 || d[0].Seg != 0 || d[0].Reason != ReasonSerious || d[0].Endurance != 1 || d[1].Delay != 2 {
		t.Errorf("delays = %v", d)
	}
	if m := ofKind(evs, 0, EvMove); len(m) != 1 || m[0].Seg != 4 || st.Chars[0].Endurance != 18 {
		t.Errorf("moves = %v, endurance %d", m, st.Chars[0].Endurance)
	}
	// LEG 1: one fatigue card per hex moved upright, none while crawling.
	st = NewState()
	st.Chars[0].Leg = 1
	st, evs = resolve(t, st, "1f:ahead,2f:ahead", "")
	if d := ofKind(evs, 0, EvDelay); len(d) != 2 || d[0].Reason != ReasonLeg || d[0].Seg != 2 || d[1].Seg != 4 || st.Chars[0].Endurance != 18 {
		t.Errorf("delays = %v", d)
	}
	st = NewState()
	st.Chars[0].Leg = 1
	st.Chars[0].Down = true
	_, evs = resolve(t, st, "1f:ahead", "")
	if d := ofKind(evs, 0, EvDelay); len(d) != 1 || d[0].Reason != ReasonCrawl {
		t.Errorf("delays = %v", d)
	}
	// Passing out: more delay than endurance at the end of two turns in a row.
	st = NewState()
	st.Chars[0].Endurance, st.Chars[0].Delay = 1, 5
	st, evs = EndTurn(st) // 5 -> 3 > 1: first turn
	if st.Chars[0].Exhausted != 1 || st.Chars[0].Status != Alive || len(evs) != 0 {
		t.Errorf("after one turn: %+v, %v", st.Chars[0], evs)
	}
	st.Chars[0].Delay = 4
	st, evs = EndTurn(st) // 4 -> 2 > 1: second turn
	if st.Chars[0].Status != PassedOut || !st.Chars[0].Down || len(evs) != 1 || evs[0].Kind != EvPassOut || AliveCount(st) != 1 {
		t.Errorf("after two turns: %+v, %v", st.Chars[0], evs)
	}
	// A turn with delay back under endurance resets the count.
	st = NewState()
	st.Chars[0].Endurance, st.Chars[0].Delay, st.Chars[0].Exhausted = 1, 1, 1
	if st, _ = EndTurn(st); st.Chars[0].Exhausted != 0 {
		t.Errorf("exhausted = %d", st.Chars[0].Exhausted)
	}
}

func TestEndShowdownSeriousCheck(t *testing.T) {
	st := NewState()
	st.Chars[0].Serious = 2
	st.Chars[1].Serious = 3
	seq := Sequence{37, 37} // DELAY 1 each: 3 survives, 4 dies
	st, evs := EndShowdown(st, &seq)
	if st.Chars[0].Status != Alive || st.Chars[1].Status != Killed {
		t.Errorf("statuses: %v %v", st.Chars[0].Status, st.Chars[1].Status)
	}
	if len(evs) != 3 || evs[0].Kind != EvSeriousCheck || evs[0].N != 3 || evs[1].N != 4 || evs[2].Kind != EvWound || evs[2].Result != string(Kill) {
		t.Errorf("events = %v", evs)
	}
	// A penalty line counts as zero.
	st = NewState()
	st.Chars[0].Serious = 3
	seq = Sequence{88} // LOSE AIM
	if st, _ = EndShowdown(st, &seq); st.Chars[0].Status != Alive {
		t.Error("LOSE AIM should count as 0")
	}
}

func TestAimAtCharacterOrHex(t *testing.T) {
	// An aim at the Kid follows it wherever it is when the aim executes
	// (segment 2): it ran from F9 to F8, still in the zone.
	st := armed(0)
	st, evs := resolve(t, st, "5f:aim:@1", "2f:ahead,1f:ahead")
	a := ofKind(evs, 0, EvAim)
	if len(a) != 1 || a[0].Seg != 2 || a[0].Target != 1 || a[0].To != "A-F8" || st.Chars[0].AimHex != "" || st.Chars[0].Aim != 2 {
		t.Errorf("aims = %v, marshal %+v", a, st.Chars[0])
	}
	// The Kid at G6 (SE of F5, in the zone) runs to G5, out of the zone
	// before the aim executes: the aim at it is cancelled.
	st = armed(0)
	st.Chars[0].Hex, st.Chars[0].Facing = "A-F5", hex.S
	st.Chars[1].Hex, st.Chars[1].Facing = "A-G6", hex.N
	_, evs = resolve(t, st, "5f:aim:@1", "2f:ahead,1f:ahead")
	if c := ofKind(evs, 0, EvCancel); len(c) != 1 || c[0].Reason != ReasonOutOfZone {
		t.Errorf("cancels = %v", c)
	}
	// An aim at a hex stays on the hex even when the Kid walks into it.
	st = armed(0)
	st, evs = resolve(t, st, "5f:aim:A-F8", "2f:ahead")
	if a = ofKind(evs, 0, EvAim); len(a) != 1 || a[0].Target != -1 || a[0].To != "A-F8" || st.Chars[0].AimHex != "A-F8" || st.Chars[1].Hex != "A-F8" {
		t.Errorf("aims = %v, marshal %+v, kid at %s", a, st.Chars[0], st.Chars[1].Hex)
	}
}

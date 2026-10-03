package engine

import (
	"testing"

	"gno.land/p/tbruyelle/gunslinger/cards/v0"
	"gno.land/p/tbruyelle/gunslinger/hex/v0"
)

// resolve plays the two plan strings on st with the BGA reference stub dice
// (every delay card is worth 1).
func resolve(t *testing.T, st State, p0, p1 string) (State, []Event) {
	t.Helper()
	return Resolve(hex.A, st, [NumPlayers]Plan{mustPlan(t, p0), mustPlan(t, p1)}, Fixed(1))
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
	if len(delays) != 2 || delays[0].Reason != ReasonLeap || delays[0].N != 2 || delays[0].Delay != 2 ||
		delays[1].Reason != ReasonCrawl || delays[1].N != 2 || delays[1].Delay != 4 {
		t.Errorf("delays = %v", delays)
	}
	cancels := ofKind(evs, 0, EvCancel)
	if len(cancels) != 1 || cancels[0].Action != cards.Turn || cancels[0].Reason != ReasonTime || cancels[0].Seg != 0 {
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
	if len(delays) != 1 || delays[0].Seg != 4 || delays[0].Reason != ReasonSprint || delays[0].N != 1 {
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
	if st != NewState() {
		t.Errorf("input state mutated: %+v", st)
	}
}

func TestEndTurnAndBudget(t *testing.T) {
	// Rule 6.3 example: 5 -> 2 -> 1 -> 0.
	for _, tt := range [][2]int{{5, 2}, {3, 1}, {2, 1}, {1, 0}, {0, 0}, {4, 2}} {
		st := NewState()
		st.Chars[0].Delay = tt[0]
		st.Chars[0].PlayedFoot, st.Chars[0].PlayedRun = true, true
		st = EndTurn(st)
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
	if st := EndTurn(NewState()); st.Chars[0].RanLastTurn {
		t.Error("RanLastTurn set without a run")
	}
	if st := EndTurn(EndTurn(func() State { s := NewState(); s.Chars[0].PlayedRun = true; return s }())); st.Chars[0].RanLastTurn {
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
